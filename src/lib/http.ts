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
 * and then stalls the body is still aborted. A passthrough TransformStream
 * wraps the body so the timer is cleared on normal stream completion.
 *
 * If `init.signal` is already set, it is used as-is (caller owns cancellation).
 */
export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs: number = ARTICLE_FETCH_TIMEOUT_MS,
): Promise<Response> {
  if (init.signal) {
    return await fetch(input, init);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new TypeError(`Request timed out after ${timeoutMs}ms: ${input}`);
    }
    throw error;
  }

  // No body (e.g. 204) — nothing to stream, clear the timer now.
  if (!response.body) {
    clearTimeout(timer);
    return response;
  }

  // Pipe through an identity transform whose flush() clears the timer when
  // the body is fully consumed. If the body stalls, the timer fires and
  // aborts the controller, which errors the stream for the caller.
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      flush() {
        clearTimeout(timer);
      },
    }),
  );

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
