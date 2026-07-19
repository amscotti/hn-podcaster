/**
 * Shared HTTP helpers (timeouts, etc.).
 */

/** Default timeout for Hacker News JSON API calls. */
export const HN_FETCH_TIMEOUT_MS = 10_000;

/** Default timeout for article page / PDF downloads. */
export const ARTICLE_FETCH_TIMEOUT_MS = 30_000;

/** Default timeout for Jina reader proxy requests. */
export const JINA_FETCH_TIMEOUT_MS = 45_000;

/** Default timeout for TTS API calls. */
export const TTS_FETCH_TIMEOUT_MS = 120_000;

/**
 * `fetch` with an AbortController timeout that covers **both** header
 * retrieval and response-body consumption.
 *
 * The timer stays active after headers arrive so a server that sends headers
 * and then stalls the body is still aborted. The body is wrapped in a
 * reader-based stream that clears the timer on completion, error, or cancel.
 *
 * If `init.signal` is provided, it is composed with the timeout signal via
 * `AbortSignal.any` — caller cancellation and the timeout both apply. A
 * caller-initiated abort is re-thrown as-is; only a timeout abort becomes a
 * `TypeError("Request timed out...")`.
 */
export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;

  let response: Response;
  try {
    response = await fetch(input, { ...init, signal });
  } catch (error) {
    clearTimeout(timer);
    if (
      controller.signal.aborted &&
      error instanceof DOMException && error.name === "AbortError"
    ) {
      throw new TypeError(`Request timed out after ${timeoutMs}ms: ${input}`);
    }
    throw error;
  }

  // No body (e.g. 204) — nothing to stream, clear the timer now.
  if (!response.body) {
    clearTimeout(timer);
    return response;
  }

  // Wrap the body so the timer is cleared on completion, error, or cancel —
  // a bare TransformStream only flushes on clean completion and would leak
  // the timer on error. If the body stalls, the timer fires and aborts the
  // controller, which errors the reader for the caller.
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          clearTimeout(timer);
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        clearTimeout(timer);
        controller.error(error);
      }
    },
    cancel(reason) {
      clearTimeout(timer);
      return reader.cancel(reason);
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
