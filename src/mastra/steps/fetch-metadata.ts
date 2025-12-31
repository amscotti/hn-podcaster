import { createStep } from "@mastra/core/workflows";
import { z } from "@zod/zod";
import { fetchStory, StorySchema } from "../../lib/hackernews.ts";
import { getAppLogger } from "../../lib/logger.ts";

const logger = getAppLogger("steps");

/**
 * Step 2: Fetch story metadata for each story ID
 */
export const fetchStoriesMetadataStep = createStep({
  id: "fetch-stories-metadata",
  inputSchema: z.object({
    storyIds: z.array(z.number()),
    storyCount: z.number(),
  }),
  outputSchema: z.object({
    stories: z.array(StorySchema),
  }),
  execute: async ({ inputData }) => {
    logger.info`Fetching metadata for ${inputData.storyIds.length} stories`;
    const allStories = await Promise.all(
      inputData.storyIds.map((id) => fetchStory(id)),
    );

    // Filter for valid stories with URLs
    const validStories = allStories.filter(
      (story) => story.type === "story" && story.url,
    );

    logger.info`Found ${validStories.length} valid stories with URLs`;
    return { stories: validStories };
  },
});
