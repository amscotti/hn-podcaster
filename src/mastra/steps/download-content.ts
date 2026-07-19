import { createStep } from "@mastra/core/workflows";
import { z } from "@zod/zod";
import { convert } from "html-to-text";
import { extractText, getDocumentProxy } from "unpdf";
import {
  type Comment,
  fetchComments,
  selectStoriesWithUrls,
  type StoryWithUrl,
  StoryWithUrlSchema,
} from "../../lib/hackernews.ts";
import {
  ARTICLE_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  JINA_FETCH_TIMEOUT_MS,
} from "../../lib/http.ts";
import { keepSuccessfulDownloads } from "../../lib/format-story.ts";
import { config } from "../../lib/config.ts";
import { getAppLogger } from "../../lib/logger.ts";

const logger = getAppLogger("steps");

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
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
});

/**
 * Reduce a thrown error to a short, readable one-liner for warning logs.
 * Deno fetch failures are verbose (URL, IP:port, transport internals, stack);
 * the useful bit is either our thrown "HTTP <status>" string or the root
 * cause message on the TypeError.
 */
function summarizeError(error: unknown): string {
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
 * PDF magic bytes: "%PDF"
 */
function isPdfBuffer(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  return bytes[0] === 0x25 && bytes[1] === 0x50 &&
    bytes[2] === 0x44 && bytes[3] === 0x46;
}

/**
 * Extract text from a PDF buffer
 */
async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/**
 * Extract text from an HTML buffer
 */
function extractHtmlText(buffer: ArrayBuffer): string {
  const html = new TextDecoder().decode(buffer);
  return convert(html, { wordwrap: 130 });
}

/**
 * Whether an error or status is transient and worth retrying. Network errors
 * (e.g. HTTP/2 stream resets, connection resets) and 5xx server responses tend
 * to resolve on a subsequent attempt; 4xx client errors will not.
 */
function isTransient(error: unknown, status: number): boolean {
  if (status >= 500) return true;
  // fetch() throws a TypeError on network/transport failures (incl. timeouts)
  return error instanceof TypeError;
}

/**
 * Download a URL and extract its text, auto-detecting PDF vs HTML by content
 * rather than URL extension. This handles cases where a `.pdf` URL serves an
 * HTML error/redirect page, or a non-`.pdf` URL serves a PDF. Transient
 * failures (network errors, 5xx) are retried with backoff so a single hiccup
 * doesn't drop a story from the podcast.
 */
async function downloadAndExtract(
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
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      return isPdfBuffer(buffer)
        ? await extractPdfText(buffer)
        : extractHtmlText(buffer);
    } catch (error) {
      lastError = error;
      const statusMatch = String(error).match(/HTTP (\d{3})/);
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      if (attempt < retries && isTransient(error, status)) {
        await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
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
async function fetchViaJina(url: string): Promise<string> {
  const key = config.jinaApiKey;
  if (!key) throw new Error("JINA_API_KEY not configured");

  const response = await fetchWithTimeout(
    `https://r.jina.ai/${url}`,
    {
      headers: new Headers({
        "Authorization": `Bearer ${key}`,
        "Accept": "text/plain",
      }),
    },
    JINA_FETCH_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`Jina HTTP ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
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
async function fetchArticleText(url: string): Promise<string> {
  try {
    return await downloadAndExtract(url);
  } catch (directError) {
    if (!config.jinaApiKey) throw directError;
    logger.debug`Direct fetch failed; trying Jina reader: ${
      summarizeError(directError)
    }`;
    const text = await fetchViaJina(url);
    logger
      .info`Fetched via Jina reader after direct failure (${text.length} chars)`;
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
 * Download article text and community comments for a single story.
 * Extracted so the backfill path can reuse the exact same logic.
 */
async function downloadStoryContent(
  story: StoryWithUrl,
  commentCount: number,
  commentCounts: Map<number, number>,
): Promise<StoryWithText> {
  let text = "";
  try {
    text = await fetchArticleText(story.url);
    logger.debug`Downloaded: ${story.title}`;
  } catch (error) {
    logger
      .warn`Failed to download ${story.title}: ${summarizeError(error)}`;
    logger.debug`Full error for ${story.title}: ${error}`;
  }

  let commentsText = "";
  // Only fetch comments when the article downloaded — stories with empty
  // text are dropped by keepSuccessfulDownloads, so their comments would
  // be wasted API calls.
  if (
    text.trim().length > 0 && commentCount > 0 && story.kids &&
    story.kids.length > 0
  ) {
    try {
      const comments = await fetchComments(story.kids, commentCount);
      commentsText = formatComments(comments);
      commentCounts.set(story.id, comments.length);
      logger
        .debug`Fetched ${comments.length} comments for ${story.title}`;
    } catch (error) {
      logger.warn`Failed to fetch comments for ${story.title}: ${
        summarizeError(error)
      }`;
      logger.debug`Full error for ${story.title}: ${error}`;
    }
  }

  return { ...story, text, commentsText };
}

/**
 * Step 3: Download webpage content for each story.
 * Drops failed downloads and trims to `storyCount` before handoff to summaries.
 * If the initial candidate pool yields too few successes, backfills from the
 * remaining HN IDs so the episode stays close to the configured size.
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
    logger
      .info`Downloading content for ${inputData.stories.length} candidate stories`;
    const commentCount = config.commentCount;
    const commentCounts = new Map<number, number>();

    const downloaded = await Promise.all(
      inputData.stories.map((story) =>
        downloadStoryContent(story, commentCount, commentCounts)
      ),
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
      const remainingIds = inputData.storyIds.filter((id) =>
        !processedIds.has(id)
      );
      const deficit = inputData.storyCount - storiesWithText.length;

      if (remainingIds.length > 0 && deficit > 0) {
        logger
          .info`Backfilling: need ${deficit} more stories, trying ${remainingIds.length} remaining IDs`;
        const moreCandidates = await selectStoriesWithUrls(
          remainingIds,
          deficit,
        );

        if (moreCandidates.length > 0) {
          const moreDownloaded = await Promise.all(
            moreCandidates.map((story) =>
              downloadStoryContent(story, commentCount, commentCounts)
            ),
          );
          const { kept: moreKept, dropped: moreDropped } =
            keepSuccessfulDownloads(
              moreDownloaded,
              inputData.storyCount - storiesWithText.length,
            );
          if (moreKept.length > 0) {
            logger
              .info`Backfill recovered ${moreKept.length} additional stories`;
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
      logger
        .warn`Dropping story with no content (will not appear in script): ${story.title}`;
    }

    if (storiesWithText.length < inputData.storyCount) {
      logger
        .warn`Only ${storiesWithText.length}/${inputData.storyCount} stories have downloadable content after filtering and backfill`;
    } else {
      logger
        .info`Keeping ${storiesWithText.length}/${inputData.storyCount} stories with content (${dropped.length} download failures dropped)`;
    }

    if (commentCount > 0) {
      const commentsOnKept = storiesWithText.filter(
        (s) => s.commentsText.length > 0,
      ).length;
      const totalKeptComments = storiesWithText.reduce(
        (sum, s) => sum + (commentCounts.get(s.id) ?? 0),
        0,
      );
      logger
        .info`Fetched comments for ${commentsOnKept} of ${storiesWithText.length} kept stories (${totalKeptComments} total comments)`;
    }

    return { storiesWithText };
  },
});
