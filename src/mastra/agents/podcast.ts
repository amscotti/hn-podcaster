import { Agent } from "@mastra/core/agent";
import { getAgentModelConfig } from "../../lib/providers.ts";
import { STYLE_INSTRUCTIONS } from "./_shared.ts";

/**
 * Agent for generating the initial podcast script
 */
export const podcastAgent = new Agent({
  name: "Podcast Script Agent",
  instructions: STYLE_INSTRUCTIONS,
  model: getAgentModelConfig("main"),
});
