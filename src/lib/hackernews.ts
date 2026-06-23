import { z } from "@zod/zod";

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
  const response = await fetch(STORIES_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch top stories: ${response.status} ${response.statusText}`,
    );
  }
  const data = await response.json();
  return TopStoriesSchema.parse(data);
}

/**
 * Fetches a story by ID from the Hacker News API
 * @param id Story ID to fetch
 * @returns Promise<Story> Validated story object from the Hacker News API
 */
export async function fetchStory(id: number): Promise<Story> {
  const storyResponse = await fetch(`${ITEM_URL_BASE}/${id}.json`);
  const data = await storyResponse.json();
  return StorySchema.parse(data);
}

/**
 * Fetches a single HN item as raw JSON (used internally for comments).
 */
async function fetchItemRaw(id: number): Promise<unknown | null> {
  try {
    const response = await fetch(`${ITEM_URL_BASE}/${id}.json`);
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
