import { assertEquals, assertRejects } from "@std/assert";
import { fetchWithTimeout } from "../lib/http.ts";

Deno.test("fetchWithTimeout - returns response on success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response("ok", { status: 200 }));
  try {
    const res = await fetchWithTimeout("https://example.com", {}, 5_000);
    assertEquals(res.status, 200);
    assertEquals(await res.text(), "ok");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchWithTimeout - aborts after timeout (headers)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => {
    return new Promise((_resolve, reject) => {
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
  };
  try {
    await assertRejects(
      () => fetchWithTimeout("https://example.com/slow", {}, 50),
      TypeError,
      "timed out",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchWithTimeout - aborts stalled body after timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // Never enqueue — stall until the abort signal fires
        init?.signal?.addEventListener("abort", () => {
          controller.error(new DOMException("Aborted", "AbortError"));
        });
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  };
  try {
    // Headers arrive fine; body read should time out
    const res = await fetchWithTimeout("https://example.com/stall", {}, 50);
    await assertRejects(
      () => res.text(),
      DOMException,
      "Aborted",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchWithTimeout - caller signal aborts without timeout conversion", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
      // never resolve — wait for abort
    });
  };
  const caller = new AbortController();
  try {
    const promise = fetchWithTimeout(
      "https://example.com",
      { signal: caller.signal },
      5_000,
    );
    caller.abort();
    // Caller abort must surface as AbortError, NOT our "timed out" TypeError
    await assertRejects(() => promise, DOMException, "Aborted");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchWithTimeout - timeout still applies when caller signal provided", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
      // never resolve — only the composed timeout signal can abort
    });
  };
  const caller = new AbortController(); // never aborted
  try {
    await assertRejects(
      () =>
        fetchWithTimeout(
          "https://example.com/slow",
          { signal: caller.signal },
          50,
        ),
      TypeError,
      "timed out",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
