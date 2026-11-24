import { expect, test } from "bun:test";
import {
  DEFAULT_OPENAI_REALTIME_INSTRUCTIONS,
  encodePcm16ToMp3,
  MAX_RETRY_AFTER_MS,
  MIN_RETRY_AFTER_MS,
  OPENAI_REALTIME_MAX_CHARS,
  OPENAI_REALTIME_VOICE_MODEL,
  OpenAIRealtimeVoice,
} from "../lib/openai-realtime-voice.ts";

async function readStreamBytes(
  stream: AsyncIterable<unknown>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    if (chunk instanceof Uint8Array) {
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

interface MockRealtimeServer {
  wsUrl: string;
  stop: () => void;
}

interface CapturedConnection {
  url: string;
  headers: Headers;
  messages: Array<Record<string, unknown>>;
}

function startMockRealtimeServer(handlers: {
  onHttp?: (req: Request, attempt: number) => Response | undefined;
  onOpen?: (
    ws: Bun.ServerWebSocket<{ conn: CapturedConnection; attempt: number }>,
  ) => void;
  onMessage?: (
    ws: Bun.ServerWebSocket<{ conn: CapturedConnection; attempt: number }>,
    msg: Record<string, unknown>,
  ) => void;
}): { server: MockRealtimeServer; connections: CapturedConnection[] } {
  const connections: CapturedConnection[] = [];
  let attemptCount = 0;

  const bunServer = Bun.serve<{ conn: CapturedConnection; attempt: number }>({
    port: 0,
    fetch(req, srv) {
      attemptCount++;
      const conn: CapturedConnection = {
        url: req.url,
        headers: req.headers,
        messages: [],
      };
      connections.push(conn);
      if (handlers.onHttp) {
        const resp = handlers.onHttp(req, attemptCount);
        if (resp) return resp;
      }
      const upgraded = srv.upgrade(req, {
        data: { conn, attempt: attemptCount },
      });
      if (!upgraded) {
        return new Response("Upgrade failed", { status: 400 });
      }
      return undefined;
    },
    websocket: {
      open(ws) {
        handlers.onOpen?.(ws);
      },
      message(ws, message) {
        const text =
          typeof message === "string"
            ? message
            : new TextDecoder().decode(message);
        const parsed = JSON.parse(text) as Record<string, unknown>;
        ws.data.conn.messages.push(parsed);
        handlers.onMessage?.(ws, parsed);
      },
    },
  });

  return {
    server: {
      wsUrl: `ws://127.0.0.1:${bunServer.port}/v1/realtime`,
      stop: () => {
        bunServer.stop(true);
      },
    },
    connections,
  };
}

test("OpenAIRealtimeVoice.speak - sends GA URL, Authorization only (no OpenAI-Beta), exact GA session.update, and reassembles PCM chunks", async () => {
  const pcmPart1 = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const pcmPart2 = new Uint8Array([7, 8, 9, 10]);
  const expectedPcm = new Uint8Array([...pcmPart1, ...pcmPart2]);
  const fakeMp3 = new Uint8Array([0xff, 0xf3, 0x80, 0x00, 0xaa, 0xbb]);
  let encodedInput: Uint8Array | undefined;

  const { server, connections } = startMockRealtimeServer({
    onOpen(ws) {
      ws.send(JSON.stringify({ type: "session.created", session: {} }));
    },
    onMessage(ws, msg) {
      if (msg.type === "session.update") {
        ws.send(JSON.stringify({ type: "session.updated", session: {} }));
      } else if (msg.type === "response.create") {
        ws.send(
          JSON.stringify({
            type: "response.output_audio.delta",
            delta: Buffer.from(pcmPart1).toString("base64"),
          }),
        );
        ws.send(
          JSON.stringify({
            type: "response.output_audio.delta",
            delta: Buffer.from(pcmPart2).toString("base64"),
          }),
        );
        ws.send(JSON.stringify({ type: "response.output_audio.done" }));
        ws.send(
          JSON.stringify({
            type: "response.done",
            response: { status: "completed" },
          }),
        );
      }
    },
  });

  try {
    const voice = new OpenAIRealtimeVoice({
      apiKey: "sk-test-secret",
      wsUrl: server.wsUrl,
      speaker: "marin",
      speed: 1.0,
      encodePcmToMp3: async (pcm) => {
        encodedInput = pcm;
        return fakeMp3;
      },
      sleep: async () => {},
    });

    const stream = await voice.speak("Hello Hacker News listeners!", {
      speaker: "cedar",
      speed: 1.15,
    });
    const output = await readStreamBytes(stream);

    expect(output).toEqual(fakeMp3);
    expect(encodedInput).toEqual(expectedPcm);
    expect(connections.length).toBe(1);

    const conn = connections[0];
    const parsedUrl = new URL(conn.url);
    expect(parsedUrl.pathname).toBe("/v1/realtime");
    expect(parsedUrl.searchParams.get("model")).toBe(
      OPENAI_REALTIME_VOICE_MODEL,
    );
    expect(conn.headers.get("authorization")).toBe("Bearer sk-test-secret");
    expect(conn.headers.get("openai-beta")).toBeNull();

    expect(conn.messages).toEqual([
      {
        type: "session.update",
        session: {
          type: "realtime",
          output_modalities: ["audio"],
          instructions: DEFAULT_OPENAI_REALTIME_INSTRUCTIONS,
          audio: {
            output: {
              format: { type: "audio/pcm", rate: 24000 },
              voice: "cedar",
              speed: 1.15,
            },
          },
        },
      },
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "Hello Hacker News listeners!" },
          ],
        },
      },
      {
        type: "response.create",
      },
    ]);
  } finally {
    server.stop();
  }
});

test("OpenAIRealtimeVoice.speak - retries transient server_error, rate_limit_exceeded, abrupt close, and 0-byte audio", async () => {
  const sleeps: number[] = [];
  const fakeMp3 = new Uint8Array([0xff, 0xf3, 0x01, 0x02]);

  const { server, connections } = startMockRealtimeServer({
    onMessage(ws, msg) {
      if (msg.type === "session.update") {
        ws.send(JSON.stringify({ type: "session.updated" }));
        return;
      }
      if (msg.type !== "response.create") return;

      const attempt = ws.data.attempt;
      if (attempt === 1) {
        ws.send(
          JSON.stringify({
            type: "error",
            error: {
              type: "server_error",
              code: "server_error",
              message: "temporary backend hiccup",
            },
          }),
        );
      } else if (attempt === 2) {
        ws.send(
          JSON.stringify({
            type: "error",
            error: {
              type: "rate_limit_error",
              code: "rate_limit_exceeded",
              message: "slow down",
              retry_after: 0,
            },
          }),
        );
      } else if (attempt === 3) {
        // Abrupt close before response.done
        ws.close(1011, "upstream reset");
      } else if (attempt === 4) {
        // 0-byte completed response
        ws.send(
          JSON.stringify({
            type: "response.done",
            response: { status: "completed" },
          }),
        );
      } else {
        ws.send(
          JSON.stringify({
            type: "response.output_audio.delta",
            delta: Buffer.from([10, 20, 30, 40]).toString("base64"),
          }),
        );
        ws.send(
          JSON.stringify({
            type: "response.done",
            response: { status: "completed" },
          }),
        );
      }
    },
  });

  try {
    const voice = new OpenAIRealtimeVoice({
      apiKey: "sk-test",
      wsUrl: server.wsUrl,
      maxRetries: 4,
      baseDelayMs: 10,
      encodePcmToMp3: async () => fakeMp3,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const out = await readStreamBytes(await voice.speak("Retry test"));
    expect(out).toEqual(fakeMp3);
    expect(connections.length).toBe(5);
    // Attempt 2 had retry_after: 0 which must be floored to MIN_RETRY_AFTER_MS (500)
    expect(sleeps.length).toBe(4);
    expect(sleeps[1]).toBe(MIN_RETRY_AFTER_MS);
  } finally {
    server.stop();
  }
});

test("OpenAIRealtimeVoice.speak - caps retry_after above MAX_RETRY_AFTER_MS and retries per-attempt timeout", async () => {
  expect(MAX_RETRY_AFTER_MS).toBe(60_000);
  const sleeps: number[] = [];
  const fakeMp3 = new Uint8Array([0xff, 0xf3, 0x05]);

  const { server, connections } = startMockRealtimeServer({
    onMessage(ws, msg) {
      if (msg.type === "session.update") {
        ws.send(JSON.stringify({ type: "session.updated" }));
        return;
      }
      if (msg.type !== "response.create") return;

      if (ws.data.attempt === 1) {
        // Stall past timeoutMs
        return;
      }
      if (ws.data.attempt === 2) {
        ws.send(
          JSON.stringify({
            type: "error",
            error: {
              code: "rate_limit_exceeded",
              message: "huge retry_after",
              retry_after: 9999,
            },
          }),
        );
        return;
      }
      ws.send(
        JSON.stringify({
          type: "response.output_audio.delta",
          delta: Buffer.from([1, 2, 3, 4]).toString("base64"),
        }),
      );
      ws.send(
        JSON.stringify({
          type: "response.done",
          response: { status: "completed" },
        }),
      );
    },
  });

  try {
    const voice = new OpenAIRealtimeVoice({
      apiKey: "sk-test",
      wsUrl: server.wsUrl,
      maxRetries: 3,
      baseDelayMs: 10,
      timeoutMs: 40,
      encodePcmToMp3: async () => fakeMp3,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const out = await readStreamBytes(await voice.speak("Timeout recovery"));
    expect(out).toEqual(fakeMp3);
    expect(connections.length).toBe(3);
    expect(sleeps.length).toBe(2);
    // Attempt 2's 9999s retry_after must fall back to backoff, not 9999000ms
    expect(sleeps[1]).toBeLessThan(1000);
  } finally {
    server.stop();
  }
});

test("OpenAIRealtimeVoice.speak - fails fast without retry on invalid_api_key, invalid_request_error, and HTTP 401 handshake", async () => {
  for (const errorEvent of [
    {
      type: "authentication_error",
      code: "invalid_api_key",
      message: "Incorrect API key provided",
    },
    {
      type: "invalid_request_error",
      code: "invalid_value",
      message: "Unsupported voice",
    },
  ]) {
    const { server, connections } = startMockRealtimeServer({
      onMessage(ws, msg) {
        if (msg.type === "session.update") {
          ws.send(JSON.stringify({ type: "error", error: errorEvent }));
        }
      },
    });
    try {
      const voice = new OpenAIRealtimeVoice({
        apiKey: "sk-bad",
        wsUrl: server.wsUrl,
        maxRetries: 3,
        baseDelayMs: 1,
        encodePcmToMp3: async (pcm) => pcm,
        sleep: async () => {},
      });
      const err = await voice.speak("Hello").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain(errorEvent.code);
      expect(connections.length).toBe(1);
    } finally {
      server.stop();
    }
  }

  // HTTP 401 handshake failure must fail fast (1 attempt)
  {
    const { server, connections } = startMockRealtimeServer({
      onHttp() {
        return new Response("Unauthorized", { status: 401 });
      },
    });
    try {
      const voice = new OpenAIRealtimeVoice({
        apiKey: "sk-bad",
        wsUrl: server.wsUrl,
        maxRetries: 3,
        baseDelayMs: 1,
        encodePcmToMp3: async (pcm) => pcm,
        sleep: async () => {},
      });
      const err = await voice.speak("Hello").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("401");
      expect(connections.length).toBe(1);
    } finally {
      server.stop();
    }
  }

  // HTTP 503 handshake failure IS transient and retries
  {
    const fakeMp3 = new Uint8Array([0xff, 0xf3, 0x99]);
    const { server, connections } = startMockRealtimeServer({
      onHttp(_req, attempt) {
        if (attempt === 1) {
          return new Response("Service Unavailable", { status: 503 });
        }
        return undefined;
      },
      onMessage(ws, msg) {
        if (msg.type === "session.update") {
          ws.send(JSON.stringify({ type: "session.updated" }));
        } else if (msg.type === "response.create") {
          ws.send(
            JSON.stringify({
              type: "response.output_audio.delta",
              delta: Buffer.from([1, 2]).toString("base64"),
            }),
          );
          ws.send(
            JSON.stringify({
              type: "response.done",
              response: { status: "completed" },
            }),
          );
        }
      },
    });
    try {
      const voice = new OpenAIRealtimeVoice({
        apiKey: "sk-ok",
        wsUrl: server.wsUrl,
        maxRetries: 2,
        baseDelayMs: 1,
        encodePcmToMp3: async () => fakeMp3,
        sleep: async () => {},
      });
      const out = await readStreamBytes(await voice.speak("Hello 503"));
      expect(out).toEqual(fakeMp3);
      expect(connections.length).toBe(2);
    } finally {
      server.stop();
    }
  }
});

test("OpenAIRealtimeVoice - validates input length, empty input, voice, and speed", async () => {
  expect(() => new OpenAIRealtimeVoice({ apiKey: "" })).toThrow(
    /OPENAI_API_KEY is required/,
  );
  expect(
    () => new OpenAIRealtimeVoice({ apiKey: "sk-test", speaker: "nova" }),
  ).toThrow(/Invalid OpenAI Realtime voice "nova"/);
  expect(
    () => new OpenAIRealtimeVoice({ apiKey: "sk-test", speed: 0.24 }),
  ).toThrow(/Invalid OpenAI Realtime voice speed/);
  expect(
    () => new OpenAIRealtimeVoice({ apiKey: "sk-test", speed: 1.51 }),
  ).toThrow(/Invalid OpenAI Realtime voice speed/);

  const voice = new OpenAIRealtimeVoice({
    apiKey: "sk-test",
    wsUrl: "ws://127.0.0.1:1/unused",
    encodePcmToMp3: async (pcm) => pcm,
  });

  await expect(voice.speak("   ")).rejects.toThrow(/empty text/);
  await expect(
    voice.speak("a".repeat(OPENAI_REALTIME_MAX_CHARS + 1)),
  ).rejects.toThrow(/4096/);
  await expect(voice.speak("Hello", { speaker: "nova" })).rejects.toThrow(
    /Invalid OpenAI Realtime voice "nova"/,
  );
  await expect(voice.speak("Hello", { speed: 2.0 })).rejects.toThrow(
    /Invalid OpenAI Realtime voice speed/,
  );
});

test("OpenAIRealtimeVoice.speak - decodes split multi-byte UTF-8 ReadableStream input cleanly", async () => {
  let receivedText = "";
  const fakeMp3 = new Uint8Array([0xff, 0xf3, 0x42]);

  const { server } = startMockRealtimeServer({
    onMessage(ws, msg) {
      if (msg.type === "session.update") {
        ws.send(JSON.stringify({ type: "session.updated" }));
      } else if (msg.type === "conversation.item.create") {
        const item = msg.item as { content?: Array<{ text?: string }> };
        receivedText = item.content?.[0]?.text ?? "";
      } else if (msg.type === "response.create") {
        ws.send(
          JSON.stringify({
            type: "response.output_audio.delta",
            delta: Buffer.from([1, 2, 3, 4]).toString("base64"),
          }),
        );
        ws.send(
          JSON.stringify({
            type: "response.done",
            response: { status: "completed" },
          }),
        );
      }
    },
  });

  try {
    const original = "Hello 🚀 café — Hacker News!";
    const encoded = new TextEncoder().encode(original);
    // Split directly inside the 4-byte 🚀 UTF-8 sequence
    const splitAt = encoded.indexOf(0xf0) + 2;
    const streamInput = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, splitAt));
        controller.enqueue(encoded.slice(splitAt));
        controller.close();
      },
    });

    const voice = new OpenAIRealtimeVoice({
      apiKey: "sk-test",
      wsUrl: server.wsUrl,
      encodePcmToMp3: async () => fakeMp3,
      sleep: async () => {},
    });

    const out = await readStreamBytes(await voice.speak(streamInput));
    expect(out).toEqual(fakeMp3);
    expect(receivedText).toBe(original);
    expect(receivedText).not.toContain("\uFFFD");
  } finally {
    server.stop();
  }
});

test("encodePcm16ToMp3 - encodes 24kHz PCM16 to headerless MP3 frames when ffmpeg is available", async () => {
  if (!Bun.which("ffmpeg")) {
    return;
  }

  // Generate 0.25s of 24kHz mono 440Hz sine wave (s16le)
  const sampleRate = 24_000;
  const numSamples = sampleRate / 4;
  const pcm = new Uint8Array(numSamples * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(
      Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16_000,
    );
    view.setInt16(i * 2, sample, true);
  }

  const mp3 = await encodePcm16ToMp3(pcm);
  expect(mp3.byteLength).toBeGreaterThan(100);
  // Must NOT begin with an ID3v2 header ("ID3") so segment concatenation stays clean
  const headerAscii = new TextDecoder().decode(mp3.slice(0, 3));
  expect(headerAscii).not.toBe("ID3");
  // Must start with MPEG2 Layer3 24kHz frame sync (0xFF 0xF3 or 0xFF 0xF2)
  expect(mp3[0]).toBe(0xff);
  expect(mp3[1] & 0xe0).toBe(0xe0);
});
