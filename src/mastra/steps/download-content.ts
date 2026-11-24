import { createStep } from "@mastra/core/workflows";
import { convert } from "html-to-text";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";
import { mapWithConcurrency } from "../../lib/concurrency.ts";
import { config } from "../../lib/config.ts";
import { keepSuccessfulDownloads } from "../../lib/format-story.ts";
import {
  type Comment,
  fetchComments,
  type StoryWithUrl,
  StoryWithUrlSchema,
  selectStoriesWithUrls,
} from "../../lib/hackernews.ts";
import {
  ARTICLE_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  JINA_FETCH_TIMEOUT_MS,
} from "../../lib/http.ts";
import { getAppLogger } from "../../lib/logger.ts";

const logger = getAppLogger("steps");

/** Maximum parallel article downloads in flight. */
export const DOWNLOAD_CONCURRENCY = 5;

/**
 * Hard ceiling on article/PDF bodies before extraction. A single
 * pathological HN link (e.g. a 500 MB PDF) must not buffer into memory;
 * stories past the cap fail with a clear error and drop (with Jina fallback
 * still attempted when configured).
 */
export const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Browser-like headers to reduce bot-detection 403s. The User-Agent alone is
 * often enough to flag a request as a scraper; a fuller Chrome-like header
 * set gets past simpler header-based checks. (Sites that fingerprint the TLS
 * handshake - e.g. Cloudflare-protected publishers - will still block, but
 * nothing short of a TLS-impersonating client defeats those.)
 */
const FETCH_HEADERS = new Headers({
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
});

/** Typed HTTP non-2xx error so retry logic inspects `.status` directly. */
export class HttpStatusError extends Error {
  readonly status: number;
  readonly statusText: string;

  constructor(status: number, statusText: string, prefix = "HTTP") {
    super(`${prefix} ${status} ${statusText}`.trim());
    this.name = "HttpStatusError";
    this.status = status;
    this.statusText = statusText;
  }
}

/**
 * Reduce a thrown error to a short, readable one-liner for warning logs.
 * Fetch failures are verbose (URL, IP:port, transport internals, stack);
 * the useful bit is either our thrown HttpStatusError or the root
 * cause message on the TypeError.
 */
function summarizeError(error: unknown): string {
  if (error instanceof HttpStatusError) return error.message;
  if (error instanceof Error) {
    const msg = error.message;
    if (/^HTTP \d{3}/.test(msg)) return msg;
    const cause = (error as Error & { cause?: { message?: string } }).cause;
    if (cause?.message) return `Network error: ${cause.message}`;
    return msg.split("\n")[0].slice(0, 100);
  }
  return String(error);
}

/**
 * Read a response body under the size cap: fail fast on an oversized
 * Content-Length, then stream with a byte cap so an unbounded body aborts
 * instead of buffering into memory.
 */
export async function readBodyWithCap(
  response: Response,
  url: string,
): Promise<ArrayBuffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const advertised = Number(contentLength);
    if (Number.isFinite(advertised) && advertised > MAX_DOWNLOAD_BYTES) {
      await response.body?.cancel().catch(() => {});
      throw new Error(
        `Download exceeds 15 MB cap: ${url} advertises ${advertised} bytes`,
      );
    }
  }
  if (!response.body) return new ArrayBuffer(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOWNLOAD_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Already handling the cap error; cancel may fail if stream errored.
        }
        throw new Error(
          `Download exceeds 15 MB cap: ${url} exceeded ${MAX_DOWNLOAD_BYTES} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Lock may already be released if the reader errored/cancelled.
    }
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined.buffer;
}

/**
 * PDF magic bytes: "%PDF"
 */
export function isPdfBuffer(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

/**
 * Extract text from a PDF buffer
 */
export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  try {
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/**
 * Extract text from an HTML buffer
 */
export function extractHtmlText(buffer: ArrayBuffer): string {
  const html = new TextDecoder().decode(buffer);
  return convert(html, { wordwrap: 130 });
}

/**
 * Whether an error or status is transient and worth retrying. Network errors
 * (e.g. HTTP/2 stream resets, connection resets), body-read abort timeouts,
 * and 5xx server responses tend to resolve on a subsequent attempt; 4xx
 * client errors will not.
 */
function isTransient(error: unknown, status: number): boolean {
  if (status >= 500) return true;
  // fetch() throws a TypeError on network/transport failures (incl. header
  // timeouts), while body-phase stalls reject with DOMException("AbortError").
  if (error instanceof TypeError) return true;
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Download a URL and extract its text, auto-detecting PDF vs HTML by content
 * rather than URL extension. This handles cases where a `.pdf` URL serves an
 * HTML error/redirect page, or a non-`.pdf` URL serves a PDF. Transient
 * failures (network errors, 5xx) are retried with backoff so a single hiccup
 * doesn't drop a story from the podcast.
 */
export async function downloadAndExtract(
  url: string,
  retries = 2,
  backoffMs = 500,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(
        url,
        { headers: FETCH_HEADERS },
        ARTICLE_FETCH_TIMEOUT_MS,
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new HttpStatusError(response.status, response.statusText);
      }
      const buffer = await readBodyWithCap(response, url);
      return isPdfBuffer(buffer)
        ? await extractPdfText(buffer)
        : extractHtmlText(buffer);
    } catch (error) {
      lastError = error;
      const status = error instanceof HttpStatusError ? error.status : 0;
      if (attempt < retries && isTransient(error, status)) {
        await Bun.sleep(backoffMs * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * Fetch article content via the Jina reader proxy (https://r.jina.ai/<url>).
 * Jina fetches the page from its own infrastructure (different IP reputation
 * and TLS fingerprint than ours) and returns clean markdown - ideal for
 * sources that block a direct fetch with bot detection. Throws if Jina itself
 * is blocked (e.g. the source serves a CAPTCHA).
 */
export async function fetchViaJina(
  url: string,
  jinaApiKey: string | undefined,
): Promise<string> {
  if (!jinaApiKey) throw new Error("JINA_API_KEY not configured");

  const response = await fetchWithTimeout(
    `https://r.jina.ai/${url}`,
    {
      headers: new Headers({
        Authorization: `Bearer ${jinaApiKey}`,
        Accept: "text/plain",
      }),
    },
    JINA_FETCH_TIMEOUT_MS,
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new HttpStatusError(
      response.status,
      response.statusText,
      "Jina HTTP",
    );
  }
  const text = new TextDecoder().decode(
    await readBodyWithCap(response, `https://r.jina.ai/${url}`),
  );
  // Jina annotates pages it couldn't fully render (e.g. CAPTCHA challenges).
  if (/requiring CAPTCHA/i.test(text)) {
    throw new Error("source served a CAPTCHA even via Jina");
  }
  return text;
}

/**
 * Fetch an article's text with a fallback chain: try directly first (fast,
 * free), and if that fails fall back to the Jina reader proxy when configured.
 * This rescues articles behind bot detection that our direct fetch can't reach.
 */
export async function fetchArticleText(
  url: string,
  jinaApiKey: string | undefined,
): Promise<string> {
  try {
    return await downloadAndExtract(url);
  } catch (directError) {
    if (!jinaApiKey) throw directError;
    logger.debug`Direct fetch failed; trying Jina reader: ${summarizeError(
      directError,
    )}`;
    const text = await fetchViaJina(url, jinaApiKey);
    logger.info`Fetched via Jina reader after direct failure (${text.length} chars)`;
    return text;
  }
}

/**
 * Convert HN comment HTML into plain text.
 */
function commentToText(comment: Comment): string {
  const author = comment.by ?? "anonymous";
  const body = convert(comment.text, { wordwrap: 130 }).trim();
  return `${author}:\n${body}`;
}

/**
 * Format a list of comments into a single readable block.
 */
function formatComments(comments: Comment[]): string {
  return comments
    .map((comment, i) => `${i + 1}. ${commentToText(comment)}`)
    .join("\n\n");
}

// Extended schema with downloaded article text and community comments
export const StoryWithTextSchema = StoryWithUrlSchema.extend({
  text: z.string(),
  commentsText: z.string().default(""),
});

export type StoryWithText = z.infer<typeof StoryWithTextSchema>;

/**
 * Download article text for a single story. Comments are fetched in a
 * separate pass only for the final kept stories so discarded buffer
 * candidates never fan out unnecessary Hacker News API requests.
 */
async function downloadStoryArticle(
  story: StoryWithUrl,
): Promise<StoryWithText> {
  let text = "";
  try {
    text = await fetchArticleText(story.url, config.jinaApiKey);
    logger.debug`Downloaded: ${story.title}`;
  } catch (error) {
    logger.warn`Failed to download ${story.title}: ${summarizeError(error)}`;
    logger.debug`Full error for ${story.title}: ${error}`;
  }

  return { ...story, text, commentsText: "" };
}

/**
 * Fetch community comments for a single kept story.
 */
async function attachStoryComments(
  story: StoryWithText,
  commentCount: number,
  commentCounts: Map<number, number>,
): Promise<StoryWithText> {
  if (commentCount <= 0 || !story.kids || story.kids.length === 0) {
    return story;
  }
  try {
    const comments = await fetchComments(story.kids, commentCount);
    const commentsText = formatComments(comments);
    commentCounts.set(story.id, comments.length);
    logger.debug`Fetched ${comments.length} comments for ${story.title}`;
    return { ...story, commentsText };
  } catch (error) {
    logger.warn`Failed to fetch comments for ${story.title}: ${summarizeError(
      error,
    )}`;
    logger.debug`Full error for ${story.title}: ${error}`;
    return story;
  }
}

/**
 * Step 3: Download webpage content for each story.
 * Drops failed downloads and trims to `storyCount` before handoff to summaries.
 * If the initial candidate pool yields too few successes, backfills from the
 * remaining HN IDs so the episode stays close to the configured size.
 * Comments are fetched only for the final kept stories.
 */
export const downloadContentStep = createStep({
  id: "download-content",
  inputSchema: z.object({
    stories: z.array(StoryWithUrlSchema),
    storyCount: z.number(),
    storyIds: z.array(z.number()),
  }),
  outputSchema: z.object({
    storiesWithText: z.array(StoryWithTextSchema),
  }),
  execute: async ({ inputData }) => {
    logger.info`Downloading content for ${inputData.stories.length} candidate stories`;
    const commentCount = config.commentCount;

    const downloaded = await mapWithConcurrency(
      inputData.stories,
      DOWNLOAD_CONCURRENCY,
      (story) => downloadStoryArticle(story),
    );

    let { kept: storiesWithText, dropped } = keepSuccessfulDownloads(
      downloaded,
      inputData.storyCount,
    );

    // Backfill from remaining IDs when too many candidates failed to download.
    // Request budget: worst case walks the remaining ~500 IDs in batches of
    // 10 plus one article download per URL story found. The walk is bounded
    // by the MAX_CONSECUTIVE_NULLS circuit breaker in selectStoriesWithUrls,
    // which stops after ~30 consecutive HN failures (~30s).
    if (storiesWithText.length < inputData.storyCount) {
      const processedIds = new Set(inputData.stories.map((s) => s.id));
      const remainingIds = inputData.storyIds.filter(
        (id) => !processedIds.has(id),
      );
      const deficit = inputData.storyCount - storiesWithText.length;

      if (remainingIds.length > 0 && deficit > 0) {
        logger.info`Backfilling: need ${deficit} more stories, trying ${remainingIds.length} remaining IDs`;
        const moreCandidates = await selectStoriesWithUrls(
          remainingIds,
          deficit,
        );

        if (moreCandidates.length > 0) {
          const moreDownloaded = await mapWithConcurrency(
            moreCandidates,
            DOWNLOAD_CONCURRENCY,
            (story) => downloadStoryArticle(story),
          );
          const { kept: moreKept, dropped: moreDropped } =
            keepSuccessfulDownloads(
              moreDownloaded,
              inputData.storyCount - storiesWithText.length,
            );
          if (moreKept.length > 0) {
            logger.info`Backfill recovered ${moreKept.length} additional stories`;
          }
          storiesWithText = [...storiesWithText, ...moreKept];
          dropped = [...dropped, ...moreDropped];
        }
      }
    }

    // Fail early — no point generating a script with zero stories.
    if (storiesWithText.length === 0) {
      throw new Error(
        "No stories have downloadable content after trying all candidates. Check network connectivity and retry.",
      );
    }

    for (const story of dropped) {
      logger.warn`Dropping story with no content (will not appear in script): ${story.title}`;
    }

    if (storiesWithText.length < inputData.storyCount) {
      logger.warn`Only ${storiesWithText.length}/${inputData.storyCount} stories have downloadable content after filtering and backfill`;
    } else {
      logger.info`Keeping ${storiesWithText.length}/${inputData.storyCount} stories with content (${dropped.length} download failures dropped)`;
    }

    if (commentCount > 0) {
      const commentCounts = new Map<number, number>();
      storiesWithText = await mapWithConcurrency(
        storiesWithText,
        DOWNLOAD_CONCURRENCY,
        (story) => attachStoryComments(story, commentCount, commentCounts),
      );
      const commentsOnKept = storiesWithText.filter(
        (s) => s.commentsText.length > 0,
      ).length;
      const totalKeptComments = storiesWithText.reduce(
        (sum, s) => sum + (commentCounts.get(s.id) ?? 0),
        0,
      );
      logger.info`Fetched comments for ${commentsOnKept} of ${storiesWithText.length} kept stories (${totalKeptComments} total comments)`;
    }

    return { storiesWithText };
  },
});
