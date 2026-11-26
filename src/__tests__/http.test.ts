import { expect, test } from "bun:test";
import { fetchWithTimeout } from "../lib/http.ts";

type FetchStub = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function stubFetch(impl: FetchStub): void {
  globalThis.fetch = impl as unknown as typeof fetch;
}

test("fetchWithTimeout - returns response on success", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch(() => Promise.resolve(new Response("ok", { status: 200 })));
  try {
    const res = await fetchWithTimeout("https://example.com", {}, 5_000);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithTimeout - aborts after timeout (headers)", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch((_input, init) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
      // never resolve — wait for abort
    });
  });
  try {
    const err = await fetchWithTimeout(
      "https://example.com/slow",
      {},
      50,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).toContain("timed out");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithTimeout - aborts stalled body after timeout", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch((_input, init) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // Never enqueue — stall until the abort signal fires
        init?.signal?.addEventListener("abort", () => {
          controller.error(new DOMException("Aborted", "AbortError"));
        });
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  });
  try {
    // Headers arrive fine; body read should time out as a TypeError matching JSDoc
    const res = await fetchWithTimeout("https://example.com/stall", {}, 50);
    const err = await res.text().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).toContain("timed out");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithTimeout - body-phase caller abort is not converted to timeout TypeError", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch((_input, init) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener("abort", () => {
          controller.error(new DOMException("Aborted", "AbortError"));
        });
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  });
  const caller = new AbortController();
  try {
    const res = await fetchWithTimeout(
      "https://example.com/stall",
      { signal: caller.signal },
      5_000,
    );
    const textPromise = res.text().catch((e: unknown) => e);
    caller.abort();
    const err = await textPromise;
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe("AbortError");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithTimeout - caller signal aborts without timeout conversion", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch((_input, init) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
      // never resolve — wait for abort
    });
  });
  const caller = new AbortController();
  try {
    const promise = fetchWithTimeout(
      "https://example.com",
      { signal: caller.signal },
      5_000,
    );
    caller.abort();
    // Caller abort must surface as AbortError, NOT our "timed out" TypeError
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as Error).message).toContain("Aborted");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithTimeout - timeout still applies when caller signal provided", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch((_input, init) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
      // never resolve — only the composed timeout signal can abort
    });
  });
  const caller = new AbortController(); // never aborted
  try {
    const err = await fetchWithTimeout(
      "https://example.com/slow",
      { signal: caller.signal },
      50,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).toContain("timed out");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithTimeout - simultaneous caller abort and timeout preserves caller AbortError", async () => {
  const originalFetch = globalThis.fetch;
  // Delay rejection slightly past the timeout so both init.signal.aborted and
  // timedOut are true when fetch rejects, reproducing the simultaneous race.
  stubFetch((_input, init) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => {
          setTimeout(
            () => reject(new DOMException("Aborted", "AbortError")),
            30,
          );
        },
        { once: true },
      );
    });
  });
  const caller = new AbortController();
  try {
    const promise = fetchWithTimeout(
      "https://example.com/race",
      { signal: caller.signal },
      10,
    );
    caller.abort();
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe("AbortError");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
