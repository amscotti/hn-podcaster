import { Agent } from "@mastra/core/agent";
import { getAgentModelConfig } from "../../lib/providers.ts";
import { STYLE_INSTRUCTIONS } from "./_shared.ts";

/**
 * Agent for applying improvements to the script
 */
export const improvementAgent = new Agent({
  name: "Script Improver Agent",
  instructions: STYLE_INSTRUCTIONS,
  model: getAgentModelConfig("main"),
});
