import { Agent } from "@mastra/core/agent";
import { getAgentModelConfig } from "../../lib/providers.ts";

/**
 * Agent for generating story summaries
 */
export const summaryAgent = new Agent({
  name: "Summary Agent",
  instructions:
    `You are preparing article summaries for a podcast host who needs to explain tech topics to a general audience.

For each article, provide:
1. The core story - what happened or what was created, in plain language
2. Why it matters - the "so what?" that makes this interesting or significant
3. Key details - the most fascinating or surprising specifics worth mentioning
4. Context - any background a general listener might need to understand this
5. Technical terms - flag any jargon that needs explaining, with simple definitions

Write in a way that captures the interesting human angle, not just the technical facts. Help the host tell a story, not just report news.

Note: Don't include code snippets or SQL - describe what they do in plain English instead.`,
  model: getAgentModelConfig("summary"),
});
