import { createStep } from "@mastra/core/workflows";
import { z } from "@zod/zod";
import { fetchTopStories } from "../../lib/hackernews.ts";
import { getAppLogger } from "../../lib/logger.ts";

const logger = getAppLogger("steps");

/**
 * Step 1: Fetch top story IDs from Hacker News.
 *
 * Returns the full top-stories list (HN provides ~500 IDs) plus the requested
 * count so the metadata step can walk past Ask/Show HN text posts and still
 * fill `storyCount` valid link stories.
 */
export const fetchTopStoriesStep = createStep({
  id: "fetch-top-stories",
  inputSchema: z.object({
    storyCount: z.number().default(10),
  }),
  outputSchema: z.object({
    storyIds: z.array(z.number()),
    storyCount: z.number(),
  }),
  execute: async ({ inputData }) => {
    logger.info`Fetching top ${inputData.storyCount} stories from Hacker News`;
    const storyIds = await fetchTopStories();
    logger
      .info`Retrieved ${storyIds.length} story IDs (will select ${inputData.storyCount} with URLs)`;
    return {
      storyIds,
      storyCount: inputData.storyCount,
    };
  },
});
