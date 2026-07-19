/**
 * Custom Mastra voice provider for xAI (Grok) Text-to-Speech.
 *
 * There is no official `@mastra/voice-xai` package, and xAI's TTS API
 * (`POST https://api.x.ai/v1/tts`) is not OpenAI-compatible, so this class
 * implements the `MastraVoice` contract directly. Docs:
 * https://docs.x.ai/developers/model-capabilities/audio/text-to-speech
 *
 * Only text-to-speech is supported (no speech-to-text).
 */

import { MastraVoice } from "@mastra/core/voice";
import { fetchWithTimeout, TTS_FETCH_TIMEOUT_MS } from "./http.ts";

const XAI_TTS_URL = "https://api.x.ai/v1/tts";

/** The five built-in xAI voices (case-insensitive). */
export const XAI_VOICE_IDS = ["eve", "ara", "rex", "sal", "leo"] as const;
export type XaiVoiceId = (typeof XAI_VOICE_IDS)[number];

export interface XaiVoiceOptions {
  apiKey: string;
  /** Voice id (eve, ara, rex, sal, leo) or a custom voice id. Defaults to "ara". */
  speaker?: string;
  /** BCP-47 language code or "auto". Defaults to "en". */
  language?: string;
  /** Speech speed multiplier (0.7 - 1.5). Defaults to 1.0. */
  speed?: number;
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

export class XaiVoice extends MastraVoice<
  unknown,
  XaiSpeakOptions,
  never
> {
  private readonly apiKey: string;
  private readonly language: string;
  private readonly speed: number;

  constructor({ apiKey, speaker, language, speed }: XaiVoiceOptions) {
    super({ speaker: speaker ?? "ara" });
    if (!apiKey) {
      throw new Error("XAI_API_KEY is required for the xAI voice provider");
    }
    this.apiKey = apiKey;
    this.language = language ?? "en";
    this.speed = speed ?? 1.0;
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
  async speak(
    input: string,
    options?: XaiSpeakOptions,
    // deno-lint-ignore no-explicit-any
  ): Promise<any> {
    const text = await readInputStream(input);
    if (!text.trim()) {
      throw new Error("Cannot synthesize empty text");
    }

    const voiceId = options?.speaker ?? this.speaker ?? "ara";
    const speed = options?.speed ?? this.speed;

    const response = await fetchWithTimeout(
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
        }),
      },
      TTS_FETCH_TIMEOUT_MS,
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `xAI TTS request failed: ${response.status} ${response.statusText}${
          detail ? ` - ${detail}` : ""
        }`,
      );
    }

    if (!response.body) {
      throw new Error("xAI TTS returned no audio body");
    }

    // response.body is a web ReadableStream; it is async-iterable
    // in Deno and yields Uint8Array chunks, which is what the workflow expects.
    // deno-lint-ignore no-explicit-any
    return response.body as any;
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
