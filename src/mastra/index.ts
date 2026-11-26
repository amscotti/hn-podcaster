/**
 * Mastra entry point - exports all agents, steps, and workflows
 */

// Agents
export {
  createScriptEditorAgent,
  type PerformanceEdit,
  type PerformanceEdits,
  performanceDirectorAgent,
  performanceEditsSchema,
  podcastAgent,
  type ScriptSuggestion,
  type ScriptSuggestions,
  STYLE_INSTRUCTIONS,
  type SuggestionCategory,
  scriptSuggestionsSchema,
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
  type PodcastWorkflowInput,
  type PodcastWorkflowOutput,
  podcastWorkflow,
} from "./workflows/podcast-generation.ts";
