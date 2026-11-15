/**
 * Custom Mastra voice provider for xAI (Grok) Text-to-Speech.
 *
 * There is still no official `@mastra/voice-xai` package (checked against
 * Mastra 1.78, Oct 2026), and xAI's TTS API (`POST https://api.x.ai/v1/tts`)
 * is not OpenAI-compatible, so this class implements the `MastraVoice`
 * contract directly. Docs:
 * https://docs.x.ai/developers/model-capabilities/audio/text-to-speech
 *
 * Note: this uses the TTS REST endpoint, which has no model-version
 * parameter — xAI upgrades the synthesis backend server-side. "Grok Voice
 * 3.0" (Oct 2026) is the separate realtime speech-to-speech Voice Agent
 * API for conversational agents; it is the wrong tool for rendering a
 * fixed script to an MP3 file, so it is deliberately not used here.
 *
 * Only text-to-speech is supported (no speech-to-text).
 */

import { MastraVoice } from "@mastra/core/voice";
import { fetchWithTimeout, TTS_FETCH_TIMEOUT_MS } from "./http.ts";
import { getAppLogger } from "./logger.ts";

const logger = getAppLogger("xai-voice");

const XAI_TTS_URL = "https://api.x.ai/v1/tts";

/** Largest `Retry-After` wait honoured; above this, fall back to backoff. */
export const MAX_RETRY_AFTER_MS = 60_000;

/** Built-in xAI voices (case-insensitive), per GET /v1/tts/voices (Oct 2026). */
export const XAI_VOICE_IDS = [
  "altair",
  "ara",
  "atlas",
  "aurora",
  "carina",
  "castor",
  "celeste",
  "cosmo",
  "eve",
  "helios",
  "helix",
  "iris",
  "kepler",
  "leo",
  "liora",
  "lumen",
  "luna",
  "lux",
  "naksh",
  "orion",
  "perseus",
  "rex",
  "rigel",
  "sal",
  "sirius",
  "ursa",
  "zagan",
  "zenith",
] as const;
export type XaiVoiceId = (typeof XAI_VOICE_IDS)[number];

export interface XaiVoiceOptions {
  apiKey: string;
  /** Built-in voice id (see XAI_VOICE_IDS) or a custom voice id. Defaults to "eve". */
  speaker?: string;
  /** BCP-47 language code or "auto". Defaults to "en". */
  language?: string;
  /** Speech speed multiplier (0.7 - 1.5). Defaults to 1.0. */
  speed?: number;
  /** Base backoff between transient-failure retries. Defaults to 1500ms. */
  retryBackoffMs?: number;
}

interface XaiSpeakOptions {
  speaker?: string;
  speed?: number;
}

/**
 * Reads a stream/iterable of unknown chunks into a single string.
 * Used when speak() is called with a ReadableStream input instead of a string.
 */
async function readInputStream(
  input: string | ReadableStream,
): Promise<string> {
  if (typeof input === "string") return input;
  let text = "";
  for await (const chunk of input as AsyncIterable<unknown>) {
    if (chunk instanceof Uint8Array) {
      text += new TextDecoder().decode(chunk);
    } else if (typeof chunk === "string") {
      text += chunk;
    }
  }
  return text;
}

/**
 * Parse a `Retry-After` header (delta-seconds or HTTP date) into
 * milliseconds. Returns undefined when absent or unparseable.
 */
function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return undefined;
  return Math.max(0, parsed - Date.now());
}

/**
 * Wrap fully-buffered audio bytes as a one-chunk web ReadableStream.
 * `speak()` buffer-verifies the segment before returning so a truncated or
 * stalled body read is retried inside `speak()` instead of surfacing as a
 * mid-stream failure in the workflow's consume loop.
 */
function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export class XaiVoice extends MastraVoice<unknown, XaiSpeakOptions, never> {
  private readonly apiKey: string;
  private readonly language: string;
  private readonly speed: number;
  private readonly retryBackoffMs: number;

  constructor({
    apiKey,
    speaker,
    language,
    speed,
    retryBackoffMs,
  }: XaiVoiceOptions) {
    super({ speaker: speaker ?? "eve" });
    if (!apiKey) {
      throw new Error("XAI_API_KEY is required for the xAI voice provider");
    }
    this.apiKey = apiKey;
    this.language = language ?? "en";
    this.speed = speed ?? 1.0;
    this.retryBackoffMs = retryBackoffMs ?? 1_500;
  }

  /**
   * Convert text to speech via xAI's TTS API.
   * Returns the raw audio byte stream (MP3 by default).
   *
   * The input is typed per the VoiceLike contract (string). The return type
   * stays `any` because the MastraVoice base class types its stream as
   * Node's `ReadableStream` (readable/read/setEncoding/...), which is
   * structurally incompatible with the web ReadableStream we return — the
   * same conflict the structural VoiceLike interface exists to avoid.
   */
  // biome-ignore lint/suspicious/noExplicitAny: web vs Node stream types conflict (see doc comment above)
  async speak(input: string, options?: XaiSpeakOptions): Promise<any> {
    const text = await readInputStream(input);
    if (!text.trim()) {
      throw new Error("Cannot synthesize empty text");
    }
    // The REST endpoint rejects text over 60,000 characters; fail with a
    // clear local error instead of an opaque API 400. The workflow chunks
    // by paragraph, so this only trips on a pathological single paragraph.
    if (text.length > 60_000) {
      throw new Error(
        `Text chunk too long for xAI TTS (${text.length} chars, max 60000)`,
      );
    }

    const voiceId = options?.speaker ?? this.speaker ?? "eve";
    const speed = options?.speed ?? this.speed;

    // Retry transient failures (network errors, 429, 5xx, truncated/aborted
    // body reads) with exponential backoff + jitter, capped at three
    // attempts: one dropped connection must not kill a finished episode's
    // audio. 4xx other than 429 fails immediately.
    const maxAttempts = 3;
    const backoffDelay = (attempt: number): number =>
      Math.round(this.retryBackoffMs * 2 ** attempt * (0.5 + Math.random()));
    const logRetry = (
      reason: string,
      attempt: number,
      delayMs: number,
    ): void => {
      logger.warn`xAI TTS retrying after ${reason} (attempt ${attempt + 1}/${maxAttempts}, waiting ${delayMs}ms)`;
    };
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await fetchWithTimeout(
          XAI_TTS_URL,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text,
              voice_id: voiceId,
              language: this.language,
              speed,
              // Pin the documented default explicitly so a future server-side
              // default change cannot silently alter episode audio format.
              output_format: {
                codec: "mp3",
                sample_rate: 24000,
                bit_rate: 128000,
              },
            }),
          },
          TTS_FETCH_TIMEOUT_MS,
        );
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts - 1 && error instanceof TypeError) {
          const delay = backoffDelay(attempt);
          logRetry(`network error: ${error}`, attempt, delay);
          await Bun.sleep(delay);
          continue;
        }
        throw error;
      }

      if (response.ok) {
        if (!response.body) {
          throw new Error("xAI TTS returned no audio body");
        }
        try {
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length === 0) {
            throw new Error("xAI TTS returned empty audio body");
          }
          return streamFromBytes(bytes);
        } catch (bodyError) {
          lastError = bodyError;
          if (attempt < maxAttempts - 1) {
            const delay = backoffDelay(attempt);
            logRetry(
              `truncated/aborted body read: ${bodyError}`,
              attempt,
              delay,
            );
            await Bun.sleep(delay);
            continue;
          }
          throw bodyError;
        }
      }

      const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
      const detail = await response.text().catch(() => "");
      lastError = new Error(
        `xAI TTS request failed: ${response.status} ${response.statusText}${
          detail ? ` - ${detail}` : ""
        }`,
      );
      const retryable = response.status === 429 || response.status >= 500;
      if (attempt < maxAttempts - 1 && retryable) {
        let delay: number;
        if (response.status === 429 && retryAfterMs !== undefined) {
          if (retryAfterMs > MAX_RETRY_AFTER_MS) {
            logger.warn`xAI TTS Retry-After ${retryAfterMs}ms exceeds ${MAX_RETRY_AFTER_MS}ms cap; falling back to backoff`;
            delay = backoffDelay(attempt);
          } else {
            delay = retryAfterMs;
          }
        } else {
          delay = backoffDelay(attempt);
        }
        logRetry(
          `HTTP ${response.status} ${response.statusText}`,
          attempt,
          delay,
        );
        await Bun.sleep(delay);
        continue;
      }
      throw lastError;
    }
    throw lastError;
  }

  /** Speech-to-text is not supported by this provider. */
  listen(): Promise<string> {
    return Promise.reject(
      new Error("xAI voice provider does not support speech-to-text"),
    );
  }

  override getSpeakers(): Promise<Array<{ voiceId: string }>> {
    return Promise.resolve(XAI_VOICE_IDS.map((voiceId) => ({ voiceId })));
  }

  override getListener(): Promise<{ enabled: boolean }> {
    return Promise.resolve({ enabled: false });
  }
}
