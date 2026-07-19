import { z } from "@zod/zod";
import { fetchWithTimeout, HN_FETCH_TIMEOUT_MS } from "./http.ts";
import { getAppLogger } from "./logger.ts";

const logger = getAppLogger("hackernews");

const STORIES_URL = "https://hacker-news.firebaseio.com/v0/topstories.json";
const ITEM_URL_BASE = "https://hacker-news.firebaseio.com/v0/item";

// Schema for top stories response (array of positive story IDs)
const TopStoriesSchema = z.array(z.number().int().positive());

// Schema for individual story object
export const StorySchema = z.object({
  id: z.number(),
  title: z.string(),
  url: z.string().optional(),
  score: z.number(),
  by: z.string(),
  time: z.number(),
  descendants: z.number().optional(),
  kids: z.array(z.number()).optional(),
  type: z.string(),
});

// Export the Story type for use in other files
export type Story = z.infer<typeof StorySchema>;

/** Schema for a story guaranteed to have a URL (external link posts). */
export const StoryWithUrlSchema = StorySchema.extend({
  url: z.string(),
});

/** Story guaranteed to have a URL (external link posts). */
export type StoryWithUrl = z.infer<typeof StoryWithUrlSchema>;

/**
 * True when the item is a link story suitable for article download.
 */
export function isStoryWithUrl(story: Story): story is StoryWithUrl {
  return story.type === "story" &&
    typeof story.url === "string" &&
    story.url.length > 0;
}

// Schema for a Hacker News comment item
export const CommentSchema = z.object({
  id: z.number(),
  by: z.string().optional(),
  text: z.string(),
  time: z.number(),
  kids: z.array(z.number()).optional(),
});

export type Comment = z.infer<typeof CommentSchema>;

/**
 * Fetches top stories from the Hacker News API
 * @returns Promise<number[]> Array of story IDs
 */
export async function fetchTopStories(): Promise<number[]> {
  const response = await fetchWithTimeout(
    STORIES_URL,
    {},
    HN_FETCH_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(
      `Failed to fetch top stories: ${response.status} ${response.statusText}`,
    );
  }
  const data = await response.json();
  return TopStoriesSchema.parse(data);
}

/**
 * Fetches a story by ID from the Hacker News API.
 * Returns null for missing/deleted items, non-objects, or schema mismatches
 * so callers can soft-skip a single bad ID without failing the whole run.
 * Network/timeout errors also soft-return null (logged by the caller if needed).
 *
 * @param id Story ID to fetch
 * @returns Promise<Story | null>
 */
export async function fetchStory(id: number): Promise<Story | null> {
  try {
    const storyResponse = await fetchWithTimeout(
      `${ITEM_URL_BASE}/${id}.json`,
      {},
      HN_FETCH_TIMEOUT_MS,
    );
    if (!storyResponse.ok) {
      logger
        .debug`fetchStory(${id}): HTTP ${storyResponse.status} ${storyResponse.statusText}`;
      return null;
    }
    const data: unknown = await storyResponse.json();
    if (data === null || typeof data !== "object") {
      logger.debug`fetchStory(${id}): missing or non-object item`;
      return null;
    }
    const parsed = StorySchema.safeParse(data);
    if (!parsed.success) {
      logger.debug`fetchStory(${id}): schema mismatch`;
    }
    return parsed.success ? parsed.data : null;
  } catch (error) {
    logger.debug`fetchStory(${id}): request failed: ${error}`;
    return null;
  }
}

/**
 * Fetches a single HN item as raw JSON (used internally for comments).
 */
async function fetchItemRaw(id: number): Promise<unknown | null> {
  try {
    const response = await fetchWithTimeout(
      `${ITEM_URL_BASE}/${id}.json`,
      {},
      HN_FETCH_TIMEOUT_MS,
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Fetches top-level comments for a story. The `kids` array on a story is
 * ordered roughly by score/recency, so the first `limit` ids give the most
 * visible (top) comments. Dead or deleted comments (no text) are dropped.
 *
 * @param ids Comment (item) ids to fetch - typically a story's `kids`
 * @param limit Maximum number of comments to fetch and return
 * @returns Promise<Comment[]> Validated comments, in `ids` order
 */
export async function fetchComments(
  ids: number[],
  limit: number,
): Promise<Comment[]> {
  const limited = ids.slice(0, Math.max(0, limit));
  if (limited.length === 0) return [];

  const items = await Promise.all(limited.map((id) => fetchItemRaw(id)));

  return items
    .filter((item): item is Record<string, unknown> => {
      if (item === null || typeof item !== "object") return false;
      // Keep only live comments with text (skip dead/deleted/poll options/etc.)
      const obj = item as Record<string, unknown>;
      return obj["type"] === "comment" &&
        typeof obj["text"] === "string";
    })
    .map((item) => CommentSchema.parse(item));
}

/** How many story IDs to resolve in parallel while backfilling. */
const SELECT_BATCH_SIZE = 10;

/**
 * Stop after this many consecutive null responses (network errors, deleted
 * items). In normal operation deleted items are rare among top stories; a long
 * run of nulls almost certainly indicates a systemic HN API outage. The
 * threshold of 30 (three full batches) avoids false positives while bounding
 * worst-case latency to ~30 seconds instead of ~500.
 */
const MAX_CONSECUTIVE_NULLS = 30;

/**
 * Walk `storyIds` in order, fetching metadata in small batches, until we have
 * `storyCount` link stories (type=story with a URL). Soft-skips null/deleted/
 * invalid items so a single bad ID cannot abort the run. Bails early after
 * {@link MAX_CONSECUTIVE_NULLS} consecutive nulls to avoid a multi-minute hang
 * during a systemic HN API outage.
 */
export async function selectStoriesWithUrls(
  storyIds: number[],
  storyCount: number,
): Promise<StoryWithUrl[]> {
  const valid: StoryWithUrl[] = [];
  const target = Math.max(0, storyCount);
  let consecutiveNulls = 0;

  for (
    let i = 0;
    i < storyIds.length && valid.length < target;
    i += SELECT_BATCH_SIZE
  ) {
    const batch = storyIds.slice(i, i + SELECT_BATCH_SIZE);
    const results = await Promise.all(batch.map((id) => fetchStory(id)));

    for (const story of results) {
      if (story === null) {
        consecutiveNulls++;
        if (consecutiveNulls >= MAX_CONSECUTIVE_NULLS) {
          return valid;
        }
        continue;
      }
      consecutiveNulls = 0;
      if (!isStoryWithUrl(story)) continue;
      valid.push(story);
      if (valid.length >= target) break;
    }
  }

  return valid;
}
