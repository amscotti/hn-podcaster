import { createStep } from "@mastra/core/workflows";
import { z } from "@zod/zod";
import { convert } from "html-to-text";
import { extractText, getDocumentProxy } from "unpdf";
import {
  type Comment,
  fetchComments,
  StorySchema,
} from "../../lib/hackernews.ts";
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
  // fetch() throws a TypeError on network/transport failures
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
      const response = await fetch(url, { headers: FETCH_HEADERS });
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

  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers: new Headers({
      "Authorization": `Bearer ${key}`,
      "Accept": "text/plain",
    }),
  });
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
export const StoryWithTextSchema = StorySchema.extend({
  text: z.string(),
  commentsText: z.string().default(""),
});

export type StoryWithText = z.infer<typeof StoryWithTextSchema>;

/**
 * Step 3: Download webpage content for each story
 */
export const downloadContentStep = createStep({
  id: "download-content",
  inputSchema: z.object({
    stories: z.array(StorySchema),
  }),
  outputSchema: z.object({
    storiesWithText: z.array(StoryWithTextSchema),
  }),
  execute: async ({ inputData }) => {
    logger.info`Downloading content for ${inputData.stories.length} stories`;
    const commentCount = config.commentCount;
    let totalComments = 0;
    let storiesWithComments = 0;
    const storiesWithText = await Promise.all(
      inputData.stories.map(async (story) => {
        // Download the linked article
        let text = "";
        try {
          const url = story.url!;
          text = await fetchArticleText(url);
          logger.debug`Downloaded: ${story.title}`;
        } catch (error) {
          logger
            .warn`Failed to download ${story.title}: ${summarizeError(error)}`;
          logger.debug`Full error for ${story.title}: ${error}`;
        }

        // Fetch top comments for additional community context
        let commentsText = "";
        if (commentCount > 0 && story.kids && story.kids.length > 0) {
          try {
            const comments = await fetchComments(story.kids, commentCount);
            commentsText = formatComments(comments);
            totalComments += comments.length;
            if (comments.length > 0) storiesWithComments++;
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
      }),
    );

    const successCount = storiesWithText.filter((s) => s.text.length > 0)
      .length;
    logger
      .info`Downloaded ${successCount}/${inputData.stories.length} stories successfully`;
    if (commentCount > 0) {
      logger
        .info`Fetched ${totalComments} comments across ${storiesWithComments} stories`;
    }
    return { storiesWithText };
  },
});

/**
 * Helper: Format story content for summarization
 */
export function formatStoryContent(
  story: StoryWithText,
  summary: string,
): string {
  const formatDate = (unixTimestamp: number): string => {
    const date = new Date(unixTimestamp * 1000);
    return date.toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  };

  return `
## ${story.title}
Posted Date: ${formatDate(story.time)}
URL: ${story.url}

### Story Text
${story.text}

### Hacker News Community Discussion
${story.commentsText || "(no comments fetched)"}

### Summary and Talking Points
${summary}
  `.trim();
}
