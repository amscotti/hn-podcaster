/**
 * Mastra entry point - exports all agents, steps, and workflows
 */

// Agents
export {
  improvementAgent,
  NO_IMPROVEMENTS_MARKER,
  podcastAgent,
  STYLE_INSTRUCTIONS,
  suggestionAgent,
  summaryAgent,
} from "./agents/index.ts";

// Steps
export {
  downloadContentStep,
  fetchStoriesMetadataStep,
  fetchTopStoriesStep,
  formatStoryContent,
  type StoryWithText,
  StoryWithTextSchema,
} from "./steps/index.ts";

// Workflows
export {
  podcastWorkflow,
  type PodcastWorkflowInput,
  type PodcastWorkflowOutput,
} from "./workflows/podcast-generation.ts";
