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

/** Browser-like headers to avoid bot detection */
const FETCH_HEADERS = new Headers({
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
});

/**
 * Detect if URL points to a PDF file
 */
function isPdfUrl(url: string): boolean {
  return url.toLowerCase().endsWith(".pdf");
}

/**
 * Extract text from a PDF URL
 */
async function extractPdfText(url: string): Promise<string> {
  const response = await fetch(url, { headers: FETCH_HEADERS });
  const buffer = await response.arrayBuffer();
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/**
 * Extract text from an HTML page
 */
async function extractHtmlText(url: string): Promise<string> {
  const response = await fetch(url, { headers: FETCH_HEADERS });
  const html = await response.text();
  return convert(html, { wordwrap: 130 });
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
          text = isPdfUrl(url)
            ? await extractPdfText(url)
            : await extractHtmlText(url);
          logger.debug`Downloaded${
            isPdfUrl(url) ? " (PDF)" : ""
          }: ${story.title}`;
        } catch (error) {
          logger.warn`Failed to download ${story.title}: ${error}`;
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
            logger.warn`Failed to fetch comments for ${story.title}: ${error}`;
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
