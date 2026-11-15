/**
 * Agent exports for the podcast generation workflow
 */
export { summaryAgent } from "./summary.ts";
export { podcastAgent } from "./podcast.ts";
export {
  GLOBAL_SUGGESTION_CATEGORIES,
  type ScriptSuggestion,
  type ScriptSuggestions,
  scriptSuggestionsSchema,
  suggestionAgent,
  type SuggestionCategory,
  WINDOW_SUGGESTION_CATEGORIES,
} from "./suggestion.ts";
export {
  createScriptEditorAgent,
  type PerformanceEdit,
  type PerformanceEdits,
  performanceDirectorAgent,
  performanceEditsSchema,
} from "./improvement.ts";
export { STYLE_INSTRUCTIONS } from "./_shared.ts";
