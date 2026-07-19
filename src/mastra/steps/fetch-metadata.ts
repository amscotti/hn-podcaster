import { createStep } from "@mastra/core/workflows";
import { z } from "@zod/zod";
import {
  selectStoriesWithUrls,
  StoryWithUrlSchema,
} from "../../lib/hackernews.ts";
import { getAppLogger } from "../../lib/logger.ts";

const logger = getAppLogger("steps");

/**
 * Extra URL stories beyond STORY_COUNT. Download failures are dropped later;
 * this buffer keeps us closer to the target episode size when a few pages 403.
 */
export const DOWNLOAD_CANDIDATE_BUFFER = 5;

/**
 * Step 2: Fetch story metadata and backfill until we have enough URL stories.
 * Selects `storyCount + DOWNLOAD_CANDIDATE_BUFFER` candidates so the download
 * step can drop failures and still aim for the configured count.
 */
export const fetchStoriesMetadataStep = createStep({
  id: "fetch-stories-metadata",
  inputSchema: z.object({
    storyIds: z.array(z.number()),
    storyCount: z.number(),
  }),
  outputSchema: z.object({
    stories: z.array(StoryWithUrlSchema),
    storyCount: z.number(),
    storyIds: z.array(z.number()),
  }),
  execute: async ({ inputData }) => {
    const candidateCount = inputData.storyCount + DOWNLOAD_CANDIDATE_BUFFER;
    logger
      .info`Selecting ${candidateCount} URL stories (${inputData.storyCount} target + ${DOWNLOAD_CANDIDATE_BUFFER} buffer) from ${inputData.storyIds.length} IDs`;

    const stories = await selectStoriesWithUrls(
      inputData.storyIds,
      candidateCount,
    );

    if (stories.length === 0) {
      throw new Error(
        "No link stories found in the top HN list. The Hacker News API may be unavailable or all top items may be text posts — retry later.",
      );
    }

    if (stories.length < candidateCount) {
      logger
        .warn`Only found ${stories.length}/${candidateCount} stories with URLs in the top list`;
    } else {
      logger.info`Found ${stories.length} candidate stories with URLs`;
    }

    return {
      stories,
      storyCount: inputData.storyCount,
      storyIds: inputData.storyIds,
    };
  },
});
