/**
 * Agent exports for the podcast generation workflow
 */

export { STYLE_INSTRUCTIONS } from "./_shared.ts";
export {
  createScriptEditorAgent,
  type PerformanceEdit,
  type PerformanceEdits,
  performanceDirectorAgent,
  performanceEditsSchema,
} from "./improvement.ts";
export { podcastAgent } from "./podcast.ts";
export {
  GLOBAL_SUGGESTION_CATEGORIES,
  type ScriptSuggestion,
  type ScriptSuggestions,
  type SuggestionCategory,
  scriptSuggestionsSchema,
  suggestionAgent,
  WINDOW_SUGGESTION_CATEGORIES,
} from "./suggestion.ts";
export { summaryAgent } from "./summary.ts";
