import config from "../config.ts";
import { OpenAILanguageModelService } from "./openai-language-model.ts";
import { OpenAITextToSpeechService } from "./openai-text-to-speech.ts";

/**
 * Factory functions for creating AI service instances
 * Centralizes service creation and makes it easy to swap implementations
 */

/**
 * Create a language model service instance
 */
export function createLanguageModelService(): OpenAILanguageModelService {
  const apiKey = config.generalAI.apiKey;
  if (!apiKey) {
    throw new Error(
      "GENERAL_AI_API_KEY is required for language model operations",
    );
  }
  return new OpenAILanguageModelService({
    apiKey,
    baseURL: config.generalAI.baseURL,
    models: config.generalAI.models,
  });
}

/**
 * Create a text-to-speech service instance
 */
export function createTextToSpeechService(): OpenAITextToSpeechService {
  const apiKey = config.tts.apiKey;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for text-to-speech operations");
  }
  return new OpenAITextToSpeechService({
    apiKey,
    baseURL: config.tts.baseURL,
    model: config.tts.model,
  });
}
