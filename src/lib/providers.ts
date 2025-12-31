/**
 * AI and Voice provider configuration.
 * Uses centralized config for provider selection and API keys.
 */

import { type AIProvider, config } from "./config.ts";

// Model mappings per provider
const AI_PROVIDER_MODELS: Record<
  AIProvider,
  { summary: string; main: string }
> = {
  xai: { summary: "grok-4-1-fast-non-reasoning", main: "grok-4-1-fast" },
  openai: { summary: "gpt-5-mini", main: "gpt-5.2" },
  anthropic: { summary: "claude-haiku-4-5", main: "claude-sonnet-4-5" },
  google: { summary: "gemini-3-pro-preview", main: "gemini-3-flash-preview" },
};

// Voice provider settings (OpenAI only)
const VOICE_CONFIG = {
  model: "gpt-4o-mini-tts",
  speaker: "nova",
  instructions:
    "You are podcaster reading today's latest news articles to your audience, " +
    "with excitement and intrigue in your voice to engage readers and entertain them. " +
    "Ensure you add pauses in between what you're saying to emphasize.",
};

/**
 * Get model config for Mastra agents
 */
export function getAgentModelConfig(type: "summary" | "main"): {
  id: `${string}/${string}`;
  apiKey: string;
} {
  const provider = config.aiProvider;
  const apiKey = config.apiKeys[provider];

  if (!apiKey) {
    throw new Error(`API key required for ${provider} provider`);
  }

  return {
    id: `${provider}/${AI_PROVIDER_MODELS[provider][type]}`,
    apiKey,
  };
}

/**
 * Get voice config for OpenAI TTS
 */
export function getVoiceConfig(): {
  model: string;
  speaker: string;
  instructions: string;
  apiKey: string;
} {
  const apiKey = config.apiKeys.openai;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for voice/TTS");
  }

  return {
    ...VOICE_CONFIG,
    apiKey,
  };
}
