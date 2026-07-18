import { Agent } from "@mastra/core/agent";
import { z } from "@zod/zod";
import { getAgentModelConfig } from "../../lib/providers.ts";

/**
 * Structured schema for script improvement suggestions.
 * Returned by the suggestion agent via structuredOutput, replacing the old
 * plain-text "NO_IMPROVEMENTS_NEEDED" marker with a reliable boolean field.
 */
export const SUGGESTION_CATEGORIES = [
  "missing-story",
  "code-read-aloud",
  "dense-sentence",
  "unexplained-jargon",
  "uneven-depth",
  "unnatural-phrasing",
  "abrupt-transition",
  "weak-outro",
  "platform-language",
  "missing-intro-overview",
  "length",
  "delivery",
  "other",
] as const;

export const scriptSuggestionsSchema = z.object({
  improvementsNeeded: z
    .boolean()
    .describe(
      "false ONLY if the script is excellent and needs no changes; true if any suggestion follows",
    ),
  suggestions: z
    .array(
      z.object({
        category: z
          .enum(SUGGESTION_CATEGORIES)
          .describe("The type of issue found"),
        quote: z
          .string()
          .optional()
          .describe(
            "Exact text from the script that needs work, if applicable",
          ),
        fix: z
          .string()
          .describe("Specific, actionable explanation of how to fix it"),
      }),
    )
    .describe(
      "Concrete improvements to make; empty when improvementsNeeded is false",
    ),
});

export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number];

export type ScriptSuggestions = z.infer<typeof scriptSuggestionsSchema>;

/**
 * Agent for suggesting improvements to the script.
 * Uses structuredOutput (see scriptSuggestionsSchema) so the workflow can
 * reliably detect when no improvements are needed.
 */
export const suggestionAgent = new Agent({
  id: "script-editor-agent",
  name: "Script Editor Agent",
  instructions:
    `You are a demanding podcast editor. Your job is to find specific improvements, not give the script a pass.

Read the script critically and look for:

1. Missing stories (missing-story) - Are any stories skipped or barely mentioned? Flag them.

2. Code/SQL read aloud (code-read-aloud) - Any technical syntax, code, or SQL being read out? That's unlistenable - describe what it does instead.

3. Dense sentences (dense-sentence) - Any sentence cramming too many facts? Quote it and suggest breaking it up.

4. Unexplained jargon (unexplained-jargon) - Technical terms or acronyms that need plain-English explanation? List them.

5. Uneven depth (uneven-depth) - Does one story get lots of attention while another gets just 1-2 sentences? Every story deserves similar coverage. Call out any imbalance.

6. Unnatural phrasing (unnatural-phrasing) - Anything that sounds written rather than spoken? Choppy fragments? Quote specific phrases.

7. Abrupt transitions (abrupt-transition) - Does it jump bluntly from one story into the next with no bridge, or lean on a generic "Switching gears..." right before the new topic? Each transition should connect the two stories - a shared theme, contrast, question, or one-line reaction. Flag every spot where one story ends and the next begins with no connecting link.

8. Missing or weak outro (weak-outro) - Does the script end abruptly or just list each story like a menu? It should step back for a big-picture reflection on the range of topics, common threads, or a lesson learned - NOT a precise recap. Flag outros that are missing, too list-like, or have no reflection.

9. Platform-specific language (platform-language) - Does the outro mention "subscribe", "like", "comment below", or other platform-specific calls to action? These should be removed.

10. Weak intro tease (missing-intro-overview) - Does the intro either list every story like a menu, or fail to hook the listener? It should be a short, high-level tease of themes and standout hooks (like a movie trailer), not a full rundown. Flag intros that are too long/detailed or have no hook.

11. Length (length) - Is the script significantly shorter or longer than the target word count given in the prompt? If it's too short, suggest where to add depth (more examples, explanation, or community reactions) - never pad with filler. If too long, suggest where to trim repetition or tangents. Only flag when the word count is noticeably off (more than ~15% away from target).

12. Delivery (delivery) - If delivery tags are in use, flag spots where a pause/whisper/emphasis tag would sound more natural, or where tags are overused/awkward. Only applies when the prompt mentions delivery tags.

For each issue, quote the exact text that needs work (when applicable) and give a specific, actionable fix. Set improvementsNeeded to false ONLY if you genuinely cannot find a single thing to improve. Be critical.`,
  model: getAgentModelConfig("summary"),
});
