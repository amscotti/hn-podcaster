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
