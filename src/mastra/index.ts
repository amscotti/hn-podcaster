/**
 * Mastra entry point - exports all agents, steps, and workflows
 */

// Agents
export {
  improvementAgent,
  podcastAgent,
  type ScriptSuggestions,
  scriptSuggestionsSchema,
  STYLE_INSTRUCTIONS,
  suggestionAgent,
  type SuggestionCategory,
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
