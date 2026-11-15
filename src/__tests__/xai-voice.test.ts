import { expect, test } from "bun:test";
import { XaiVoice } from "../lib/xai-voice.ts";

type FetchStub = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function stubFetch(impl: FetchStub): void {
  globalThis.fetch = impl as unknown as typeof fetch;
}

async function readStreamText(stream: AsyncIterable<unknown>): Promise<string> {
  let text = "";
  for await (const chunk of stream) {
    if (chunk instanceof Uint8Array) text += new TextDecoder().decode(chunk);
  }
  return text;
}

test("XaiVoice.speak - retries transient network failure then succeeds", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  stubFetch(() => {
    calls++;
    if (calls === 1) {
      return Promise.reject(new TypeError("ECONNREFUSED: unable to connect"));
    }
    return Promise.resolve(new Response("fake-audio-bytes"));
  });
  try {
    const voice = new XaiVoice({ apiKey: "test-key", retryBackoffMs: 1 });
    const stream = await voice.speak("Hello world");
    expect(await readStreamText(stream)).toBe("fake-audio-bytes");
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("XaiVoice.speak - retries 5xx then succeeds", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  stubFetch(() => {
    calls++;
    if (calls === 1) {
      return Promise.resolve(
        new Response("upstream busy", {
          status: 503,
          statusText: "Service Unavailable",
        }),
      );
    }
    return Promise.resolve(new Response("ok-bytes"));
  });
  try {
    const voice = new XaiVoice({ apiKey: "test-key", retryBackoffMs: 1 });
    const stream = await voice.speak("Hello again");
    expect(await readStreamText(stream)).toBe("ok-bytes");
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("XaiVoice.speak - does not retry 4xx", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  stubFetch(() => {
    calls++;
    return Promise.resolve(
      new Response("bad voice id", { status: 400, statusText: "Bad Request" }),
    );
  });
  try {
    const voice = new XaiVoice({ apiKey: "test-key", retryBackoffMs: 1 });
    const err = await voice.speak("Hello").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("400");
    expect(calls).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("XaiVoice.speak - rejects empty text without calling the API", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  stubFetch(() => {
    calls++;
    return Promise.resolve(new Response("unused"));
  });
  try {
    const voice = new XaiVoice({ apiKey: "test-key", retryBackoffMs: 1 });
    const err = await voice.speak("   ").catch((e: unknown) => e);
    expect((err as Error).message).toContain("empty text");
    expect(calls).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("XaiVoice.speak - retries 429 honouring Retry-After", async () => {
  const originalFetch = globalThis.fetch;
  const originalSleep = Bun.sleep;
  const sleeps: number[] = [];
  // @ts-expect-error probe: Bun.sleep is patched in tests to avoid real waits
  Bun.sleep = (ms: number) => {
    sleeps.push(ms);
    return Promise.resolve();
  };
  let calls = 0;
  stubFetch(() => {
    calls++;
    if (calls === 1) {
      return Promise.resolve(
        new Response("rate limited", {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "Retry-After": "2" },
        }),
      );
    }
    return Promise.resolve(new Response("ok-after-429"));
  });
  try {
    const voice = new XaiVoice({ apiKey: "test-key", retryBackoffMs: 1 });
    const stream = await voice.speak("Hello");
    expect(await readStreamText(stream)).toBe("ok-after-429");
    expect(calls).toBe(2);
    // Retry-After: 2 seconds must be honoured as 2000ms, not the 1ms backoff.
    expect(sleeps).toEqual([2000]);
  } finally {
    globalThis.fetch = originalFetch;
    Bun.sleep = originalSleep;
  }
});

test("XaiVoice.speak - retries 429 without Retry-After via backoff", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  stubFetch(() => {
    calls++;
    if (calls === 1) {
      return Promise.resolve(
        new Response("rate limited", {
          status: 429,
          statusText: "Too Many Requests",
        }),
      );
    }
    return Promise.resolve(new Response("ok-no-header"));
  });
  try {
    const voice = new XaiVoice({ apiKey: "test-key", retryBackoffMs: 1 });
    expect(await readStreamText(await voice.speak("Hello"))).toBe(
      "ok-no-header",
    );
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("XaiVoice.speak - exhausts bounded attempts on persistent 503", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  stubFetch(() => {
    calls++;
    return Promise.resolve(
      new Response("down", { status: 503, statusText: "Unavailable" }),
    );
  });
  try {
    const voice = new XaiVoice({ apiKey: "test-key", retryBackoffMs: 1 });
    const err = await voice.speak("Hello").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("503");
    expect(calls).toBe(3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("XaiVoice.speak - retries mid-body abort then succeeds", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  stubFetch(() => {
    calls++;
    if (calls === 1) {
      const aborted = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("aborted mid-body"));
        },
      });
      return Promise.resolve(new Response(aborted, { status: 200 }));
    }
    return Promise.resolve(new Response("recovered-bytes"));
  });
  try {
    const voice = new XaiVoice({ apiKey: "test-key", retryBackoffMs: 1 });
    const stream = await voice.speak("Hello");
    expect(await readStreamText(stream)).toBe("recovered-bytes");
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
