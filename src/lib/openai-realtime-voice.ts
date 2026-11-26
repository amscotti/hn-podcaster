/**
 * Custom voice provider for OpenAI's GA Realtime API (`gpt-realtime-2.1-mini`).
 *
 * OpenAI's legacy REST TTS models (`tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`)
 * shut down on 2027-01-06 and their replacement is Realtime-API only. This
 * client hand-rolls the minimal GA WebSocket flow over Bun's native
 * `WebSocket` (avoiding `@mastra/voice-openai-realtime` and its extra
 * dependency tree) and encodes the returned 24kHz mono PCM16 audio to
 * headerless CBR MP3 frames via `ffmpeg` (`Bun.spawn`) so segments
 * concatenate cleanly in the workflow's MP3 sink.
 *
 * GA protocol note: do NOT send the retired `OpenAI-Beta: realtime=v1` header.
 */

import { getAppLogger } from "./logger.ts";

const logger = getAppLogger("openai-realtime-voice");

/** Default OpenAI Realtime model for podcast TTS synthesis. */
export const OPENAI_REALTIME_VOICE_MODEL = "gpt-realtime-2.1-mini";

const OPENAI_REALTIME_BASE_URL = "wss://api.openai.com/v1/realtime";

/** Official OpenAI Realtime GA voice roster. */
export const OPENAI_REALTIME_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "cedar",
  "echo",
  "marin",
  "sage",
  "shimmer",
  "verse",
] as const;

export type OpenAIRealtimeVoiceId = (typeof OPENAI_REALTIME_VOICES)[number];

/** Default OpenAI Realtime voice. */
export const DEFAULT_OPENAI_REALTIME_VOICE: OpenAIRealtimeVoiceId = "marin";

/** Minimum supported speech speed multiplier for OpenAI Realtime audio output. */
export const OPENAI_VOICE_SPEED_MIN = 0.25;

/** Maximum supported speech speed multiplier for OpenAI Realtime audio output. */
export const OPENAI_VOICE_SPEED_MAX = 1.5;

/** Default OpenAI Realtime speech speed multiplier. */
export const DEFAULT_OPENAI_VOICE_SPEED = 1.0;

/**
 * Maximum characters per synthesis segment. Matches the 4,000-char workflow
 * segmentation budget with small headroom; rejects pathological single inputs
 * locally instead of failing mid-session.
 */
export const OPENAI_REALTIME_MAX_CHARS = 4096;

/** Smallest retry-after wait honoured, so `0` does not retry immediately. */
export const MIN_RETRY_AFTER_MS = 500;

/** Largest retry-after wait honoured; above this, fall back to backoff. */
export const MAX_RETRY_AFTER_MS = 60_000;

/** Default narration prompt instructing verbatim podcast reading. */
export const DEFAULT_OPENAI_REALTIME_INSTRUCTIONS =
  "You are a podcast narrator. Read the user's text aloud verbatim from start to finish. Do not greet, comment, answer, summarize, or add/remove any words.";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 60_000;

const RETRYABLE_ERROR_CODES = new Set([
  "rate_limit_exceeded",
  "server_error",
  "service_unavailable",
  "slow_down",
  "engine_overloaded",
  "overloaded",
  "internal_error",
]);

const NON_RETRYABLE_ERROR_CODES = new Set([
  "invalid_api_key",
  "authentication_error",
  "invalid_request_error",
  "invalid_value",
  "model_not_found",
  "invalid_model",
  "missing_required_parameter",
  "unknown_parameter",
  "unsupported_value",
  "beta_api_shape_disabled",
  "insufficient_quota",
  "billing_hard_limit_reached",
  "account_deactivated",
  "invalid_auth",
]);

const NON_RETRYABLE_ERROR_TYPES = new Set([
  "invalid_request_error",
  "authentication_error",
  "permission_error",
]);

export interface OpenAIRealtimeVoiceOptions {
  apiKey: string;
  /** Realtime model id. Defaults to `gpt-realtime-2.1-mini`. */
  model?: string;
  /** OpenAI Realtime GA voice id. Defaults to `"marin"`. */
  speaker?: string;
  /** Speech speed multiplier (`0.25` - `1.5`). Defaults to `1.0`. */
  speed?: number;
  /** Narration instructions sent in `session.update`. */
  instructions?: string;
  /** WebSocket endpoint override (for tests). */
  wsUrl?: string;
  /** Maximum retries after transient failures (`0` disables retries). Defaults to `3`. */
  maxRetries?: number;
  /** Base exponential backoff delay in ms. Defaults to `1000`. */
  baseDelayMs?: number;
  /** Per-attempt timeout in ms. Defaults to `60_000`. */
  timeoutMs?: number;
  /** Injectable PCM16-to-MP3 encoder (defaults to `encodePcm16ToMp3`). */
  encodePcmToMp3?: (pcm: Uint8Array) => Promise<Uint8Array>;
  /** Injectable sleep helper (defaults to `Bun.sleep`). */
  sleep?: (ms: number) => Promise<void>;
}

export interface OpenAIRealtimeSpeakOptions {
  speaker?: string;
  speed?: number;
  instructions?: string;
}

interface RealtimeErrorPayload {
  type?: string;
  code?: string;
  message?: string;
  retry_after?: number;
}

class RealtimeVoiceError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: { retryable: boolean; retryAfterMs?: number },
  ) {
    super(message);
    this.name = "RealtimeVoiceError";
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
  }
}

function isOpenAIRealtimeVoice(value: string): value is OpenAIRealtimeVoiceId {
  return (OPENAI_REALTIME_VOICES as readonly string[]).includes(value);
}

function validateSpeaker(speaker: string): OpenAIRealtimeVoiceId {
  if (!isOpenAIRealtimeVoice(speaker)) {
    throw new Error(
      `Invalid OpenAI Realtime voice "${speaker}". Must be one of: ${OPENAI_REALTIME_VOICES.join(", ")}`,
    );
  }
  return speaker;
}

function validateSpeed(speed: number): number {
  if (
    !Number.isFinite(speed) ||
    speed < OPENAI_VOICE_SPEED_MIN ||
    speed > OPENAI_VOICE_SPEED_MAX
  ) {
    throw new Error(
      `Invalid OpenAI Realtime voice speed ${speed}. Must be between ${OPENAI_VOICE_SPEED_MIN} and ${OPENAI_VOICE_SPEED_MAX}`,
    );
  }
  return speed;
}

/**
 * Reads a string or byte/string stream into a single UTF-8 string using one
 * streaming TextDecoder so multi-byte sequences split across chunks decode cleanly.
 */
async function readInputStream(
  input: string | ReadableStream | AsyncIterable<unknown>,
): Promise<string> {
  if (typeof input === "string") return input;
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of input as AsyncIterable<unknown>) {
    if (chunk instanceof Uint8Array) {
      text += decoder.decode(chunk, { stream: true });
    } else if (ArrayBuffer.isView(chunk)) {
      text += decoder.decode(
        new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
        { stream: true },
      );
    } else if (chunk instanceof ArrayBuffer) {
      text += decoder.decode(new Uint8Array(chunk), { stream: true });
    } else if (typeof chunk === "string") {
      text += chunk;
    }
  }
  text += decoder.decode();
  return text;
}

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function isRetryableRealtimeError(error?: RealtimeErrorPayload): boolean {
  if (!error) return true;
  const code = error.code?.toLowerCase();
  const type = error.type?.toLowerCase();

  if (code && RETRYABLE_ERROR_CODES.has(code)) return true;
  if (type === "server_error" || type === "rate_limit_error") return true;
  if (code && NON_RETRYABLE_ERROR_CODES.has(code)) return false;
  if (type && NON_RETRYABLE_ERROR_TYPES.has(type)) return false;

  // Unknown server-side error: treat as transient.
  return true;
}

function isRetryableHandshakeMessage(message: string): boolean {
  const match = message.match(/status code:\s*(\d{3})\b/i);
  if (match) {
    const status = Number(match[1]);
    if (status === 429 || status === 408 || status >= 500) return true;
    if (status >= 400 && status < 500) return false;
  }
  return true;
}

function formatRealtimeError(
  prefix: string,
  error?: RealtimeErrorPayload,
): string {
  const parts: string[] = [];
  if (error?.type) parts.push(error.type);
  if (error?.code && error.code !== error.type) parts.push(error.code);
  const tag = parts.length > 0 ? ` (${parts.join("/")})` : "";
  const detail = error?.message ? `: ${error.message.slice(0, 500)}` : "";
  return `${prefix}${tag}${detail}`;
}

/**
 * Encode raw 24kHz mono signed 16-bit LE PCM bytes to headerless 128kbps CBR
 * MP3 frames using `ffmpeg` via `Bun.spawn`.
 *
 * `-write_xing 0 -id3v2_version 0` strip per-segment metadata headers so
 * multiple synthesized segments concatenate cleanly into one `.mp3` file.
 */
export async function encodePcm16ToMp3(pcm: Uint8Array): Promise<Uint8Array> {
  if (pcm.byteLength === 0) {
    throw new Error("Cannot encode empty PCM audio");
  }
  const ffmpegPath = Bun.which("ffmpeg");
  if (!ffmpegPath) {
    throw new Error(
      "ffmpeg is required on PATH to encode OpenAI Realtime PCM audio to MP3 (install ffmpeg or use VOICE_PROVIDER=xai)",
    );
  }

  const proc = Bun.spawn(
    [
      ffmpegPath,
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "s16le",
      "-ar",
      "24000",
      "-ac",
      "1",
      "-i",
      "pipe:0",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "-write_xing",
      "0",
      "-id3v2_version",
      "0",
      "-f",
      "mp3",
      "pipe:1",
    ],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const stdoutPromise = new Response(proc.stdout).arrayBuffer();
  const stderrPromise = new Response(proc.stderr).text();

  try {
    await proc.stdin.write(pcm);
    await proc.stdin.end();
  } catch {
    // Process may exit early on invalid input; inspect exitCode + stderr below.
  }

  const [exitCode, stdoutBuf, stderrText] = await Promise.all([
    proc.exited,
    stdoutPromise,
    stderrPromise,
  ]);

  if (exitCode !== 0) {
    const detail = stderrText.trim().slice(0, 500);
    throw new Error(
      `ffmpeg PCM-to-MP3 encoding failed (exit ${exitCode})${
        detail ? `: ${detail}` : ""
      }`,
    );
  }

  const mp3Bytes = new Uint8Array(stdoutBuf);
  if (mp3Bytes.byteLength === 0) {
    throw new Error("ffmpeg produced empty MP3 output");
  }
  return mp3Bytes;
}

export class OpenAIRealtimeVoice {
  readonly model: string;
  readonly speaker: OpenAIRealtimeVoiceId;
  readonly speed: number;
  readonly instructions: string;

  private readonly apiKey: string;
  private readonly wsUrl: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly timeoutMs: number;
  private readonly encodePcmToMp3: (pcm: Uint8Array) => Promise<Uint8Array>;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor({
    apiKey,
    model,
    speaker,
    speed,
    instructions,
    wsUrl,
    maxRetries,
    baseDelayMs,
    timeoutMs,
    encodePcmToMp3,
    sleep,
  }: OpenAIRealtimeVoiceOptions) {
    if (!apiKey?.trim()) {
      throw new Error(
        "OPENAI_API_KEY is required for the OpenAI voice provider",
      );
    }

    this.apiKey = apiKey;
    this.model = model ?? OPENAI_REALTIME_VOICE_MODEL;
    this.speaker = validateSpeaker(speaker ?? DEFAULT_OPENAI_REALTIME_VOICE);
    this.speed = validateSpeed(speed ?? DEFAULT_OPENAI_VOICE_SPEED);
    this.instructions = instructions ?? DEFAULT_OPENAI_REALTIME_INSTRUCTIONS;

    const url = new URL(wsUrl ?? OPENAI_REALTIME_BASE_URL);
    if (!url.searchParams.has("model")) {
      url.searchParams.set("model", this.model);
    }
    this.wsUrl = url.toString();

    const resolvedMaxRetries = maxRetries ?? DEFAULT_MAX_RETRIES;
    if (!Number.isInteger(resolvedMaxRetries) || resolvedMaxRetries < 0) {
      throw new Error(
        `Invalid maxRetries: ${resolvedMaxRetries} (expected a non-negative integer)`,
      );
    }
    this.maxRetries = resolvedMaxRetries;

    const resolvedBaseDelay = baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    if (!Number.isFinite(resolvedBaseDelay) || resolvedBaseDelay < 0) {
      throw new Error(
        `Invalid baseDelayMs: ${resolvedBaseDelay} (expected a non-negative number)`,
      );
    }
    this.baseDelayMs = resolvedBaseDelay;

    const resolvedTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(resolvedTimeout) || resolvedTimeout <= 0) {
      throw new Error(
        `Invalid timeoutMs: ${resolvedTimeout} (expected a positive number)`,
      );
    }
    this.timeoutMs = resolvedTimeout;

    this.encodePcmToMp3 = encodePcmToMp3 ?? encodePcm16ToMp3;
    this.sleep = sleep ?? ((ms: number) => Bun.sleep(ms));
  }

  /**
   * Convert text (or a UTF-8 byte/string stream) to MP3 audio via OpenAI's
   * GA Realtime WebSocket API. Uses a fresh WebSocket per attempt so retries
   * are isolated and conversation context never accumulates across segments.
   */
  async speak(
    input: string | ReadableStream | AsyncIterable<unknown>,
    options?: OpenAIRealtimeSpeakOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    const text = await readInputStream(input);
    if (!text.trim()) {
      throw new Error("Cannot synthesize empty text");
    }
    if (text.length > OPENAI_REALTIME_MAX_CHARS) {
      throw new Error(
        `Text chunk too long for OpenAI Realtime TTS (${text.length} chars, max ${OPENAI_REALTIME_MAX_CHARS})`,
      );
    }

    const speaker = validateSpeaker(options?.speaker ?? this.speaker);
    const speed = validateSpeed(options?.speed ?? this.speed);
    const instructions = options?.instructions ?? this.instructions;

    const maxAttempts = this.maxRetries + 1;
    const backoffDelay = (attempt: number): number =>
      Math.round(this.baseDelayMs * 2 ** attempt * (0.5 + Math.random()));

    let lastError: unknown;
    let pcmBytes: Uint8Array | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        pcmBytes = await this.synthesizePcmOnce(
          text,
          speaker,
          speed,
          instructions,
        );
        break;
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof RealtimeVoiceError ? error.retryable : true;
        if (!retryable || attempt >= maxAttempts - 1) {
          throw error;
        }

        let delay: number;
        const retryAfterMs =
          error instanceof RealtimeVoiceError ? error.retryAfterMs : undefined;
        if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs)) {
          if (retryAfterMs > MAX_RETRY_AFTER_MS) {
            logger.warn`OpenAI Realtime TTS retry_after ${retryAfterMs}ms exceeds ${MAX_RETRY_AFTER_MS}ms cap; falling back to backoff`;
            delay = backoffDelay(attempt);
          } else {
            delay = Math.max(MIN_RETRY_AFTER_MS, retryAfterMs);
          }
        } else {
          delay = backoffDelay(attempt);
        }

        logger.warn`OpenAI Realtime TTS retrying after ${error instanceof Error ? error.message : String(error)} (attempt ${attempt + 1}/${maxAttempts}, waiting ${delay}ms)`;
        await this.sleep(delay);
      }
    }

    if (!pcmBytes) {
      throw lastError ?? new Error("OpenAI Realtime TTS synthesis failed");
    }

    const mp3Bytes = await this.encodePcmToMp3(pcmBytes);
    if (mp3Bytes.byteLength === 0) {
      throw new Error("OpenAI Realtime TTS encoder returned empty MP3 output");
    }
    return streamFromBytes(mp3Bytes);
  }

  private synthesizePcmOnce(
    text: string,
    speaker: OpenAIRealtimeVoiceId,
    speed: number,
    instructions: string,
  ): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      let sessionUpdateSent = false;
      let requestSent = false;
      const pcmChunks: Uint8Array[] = [];
      let totalPcmBytes = 0;

      // Bun's native WebSocket supports custom upgrade headers.
      // CRITICAL (GA API): send Authorization ONLY; omit OpenAI-Beta.
      const ws = new WebSocket(this.wsUrl, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      const cleanup = (): void => {
        clearTimeout(timer);
        try {
          if (
            ws.readyState === WebSocket.CONNECTING ||
            ws.readyState === WebSocket.OPEN
          ) {
            ws.close();
          }
        } catch {
          // Ignore close errors during teardown.
        }
      };

      const finishResolve = (bytes: Uint8Array): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(bytes);
      };

      const finishReject = (err: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      const timer = setTimeout(() => {
        finishReject(
          new RealtimeVoiceError(
            `OpenAI Realtime TTS timed out after ${this.timeoutMs}ms`,
            { retryable: true },
          ),
        );
      }, this.timeoutMs);

      const sendJson = (payload: unknown): void => {
        ws.send(JSON.stringify(payload));
      };

      const sendSessionUpdate = (): void => {
        if (sessionUpdateSent || settled) return;
        sessionUpdateSent = true;
        sendJson({
          type: "session.update",
          session: {
            type: "realtime",
            output_modalities: ["audio"],
            instructions,
            audio: {
              output: {
                format: { type: "audio/pcm", rate: 24000 },
                voice: speaker,
                speed,
              },
            },
          },
        });
      };

      const sendTextAndCreateResponse = (): void => {
        if (requestSent || settled) return;
        requestSent = true;
        sendJson({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text }],
          },
        });
        sendJson({
          type: "response.create",
        });
      };

      ws.addEventListener("open", () => {
        try {
          sendSessionUpdate();
        } catch (err) {
          finishReject(
            new RealtimeVoiceError(
              `OpenAI Realtime WebSocket send failed: ${err instanceof Error ? err.message : String(err)}`,
              { retryable: true },
            ),
          );
        }
      });

      ws.addEventListener("message", (event) => {
        if (settled) return;
        let raw: string;
        if (typeof event.data === "string") {
          raw = event.data;
        } else if (event.data instanceof ArrayBuffer) {
          raw = new TextDecoder().decode(event.data);
        } else if (ArrayBuffer.isView(event.data)) {
          raw = new TextDecoder().decode(
            new Uint8Array(
              event.data.buffer,
              event.data.byteOffset,
              event.data.byteLength,
            ),
          );
        } else {
          return;
        }

        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return;
        }

        const eventType = msg.type;
        if (eventType === "session.created") {
          sendSessionUpdate();
          return;
        }

        if (eventType === "session.updated") {
          try {
            sendTextAndCreateResponse();
          } catch (err) {
            finishReject(
              new RealtimeVoiceError(
                `OpenAI Realtime WebSocket send failed: ${err instanceof Error ? err.message : String(err)}`,
                { retryable: true },
              ),
            );
          }
          return;
        }

        if (eventType === "response.output_audio.delta") {
          const delta = msg.delta;
          if (typeof delta === "string" && delta.length > 0) {
            const buf = Buffer.from(delta, "base64");
            const bytes = new Uint8Array(
              buf.buffer,
              buf.byteOffset,
              buf.byteLength,
            );
            if (bytes.byteLength > 0) {
              pcmChunks.push(bytes);
              totalPcmBytes += bytes.byteLength;
            }
          }
          return;
        }

        if (eventType === "response.done") {
          const response = msg.response as
            | {
                status?: string;
                status_details?: {
                  error?: RealtimeErrorPayload;
                  reason?: string;
                };
              }
            | undefined;
          const status = response?.status;
          if (status !== "completed") {
            const errPayload = response?.status_details?.error;
            const retryable = isRetryableRealtimeError(errPayload);
            const reasonSuffix =
              !errPayload && response?.status_details?.reason
                ? `: ${response.status_details.reason}`
                : "";
            finishReject(
              new RealtimeVoiceError(
                formatRealtimeError(
                  `OpenAI Realtime response ended with status "${status ?? "unknown"}"${reasonSuffix}`,
                  errPayload,
                ),
                { retryable },
              ),
            );
            return;
          }

          if (totalPcmBytes === 0) {
            finishReject(
              new RealtimeVoiceError(
                "OpenAI Realtime TTS returned empty audio",
                { retryable: true },
              ),
            );
            return;
          }

          const combined = new Uint8Array(totalPcmBytes);
          let offset = 0;
          for (const chunk of pcmChunks) {
            combined.set(chunk, offset);
            offset += chunk.byteLength;
          }
          finishResolve(combined);
          return;
        }

        if (eventType === "error") {
          const errPayload = msg.error as RealtimeErrorPayload | undefined;
          const retryable = isRetryableRealtimeError(errPayload);
          const retryAfterMs =
            typeof errPayload?.retry_after === "number"
              ? errPayload.retry_after * 1000
              : undefined;
          finishReject(
            new RealtimeVoiceError(
              formatRealtimeError("OpenAI Realtime API error", errPayload),
              { retryable, retryAfterMs },
            ),
          );
        }
      });

      ws.addEventListener("error", (event) => {
        if (settled) return;
        const message =
          "message" in event && typeof event.message === "string"
            ? event.message
            : "WebSocket connection error";
        const retryable = isRetryableHandshakeMessage(message);
        finishReject(
          new RealtimeVoiceError(
            `OpenAI Realtime WebSocket error: ${message.slice(0, 500)}`,
            { retryable },
          ),
        );
      });

      ws.addEventListener("close", (event) => {
        if (settled) return;
        const reason = event.reason ? ` (${event.reason.slice(0, 500)})` : "";
        const retryable =
          event.code !== 4000 &&
          !/invalid_api_key|authentication_error|invalid_request_error|beta_api_shape_disabled/i.test(
            event.reason ?? "",
          );
        finishReject(
          new RealtimeVoiceError(
            `OpenAI Realtime WebSocket closed unexpectedly before response.done: code ${event.code}${reason}`,
            { retryable },
          ),
        );
      });
    });
  }

  getSpeakers(): Promise<Array<{ voiceId: string }>> {
    return Promise.resolve(
      OPENAI_REALTIME_VOICES.map((voiceId) => ({ voiceId })),
    );
  }

  getListener(): Promise<{ enabled: boolean }> {
    return Promise.resolve({ enabled: false });
  }
}
