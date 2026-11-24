/**
 * AI and Voice provider configuration.
 * Uses centralized config for provider selection and API keys.
 */

import { type AIProvider, type Config, config } from "./config.ts";
import { getAppLogger } from "./logger.ts";
import {
  DEFAULT_OPENAI_REALTIME_INSTRUCTIONS,
  OpenAIRealtimeVoice,
} from "./openai-realtime-voice.ts";
import { XaiVoice } from "./xai-voice.ts";

const logger = getAppLogger("providers");

// Model mappings per provider. grok-4.7 is a slow reasoning model
// (measured Oct 2026: 26-33s even on trivial structured calls, 146s for
// script generation), so every call site must keep individual requests
// small: summaries run per story in parallel, and the improvement loop
// uses windowed suggestion passes plus paragraph-level tool edits
// (see podcast-generation workflow). Do not reintroduce whole-episode
// mega-calls on this model; they exceed the ~300s per-request ceiling.
// OpenAI mapping updated Nov 2026 from OpenAI docs/model catalog (not yet
// live-verified locally with an OpenAI API key): summary gpt-6-luna
// (cheap/fast for per-story summaries), main gpt-6.1-sol (mid-tier for
// the script).
const AI_PROVIDER_MODELS: Record<
  AIProvider,
  { summary: string; main: string }
> = {
  xai: { summary: "grok-4.7", main: "grok-4.7" },
  openai: { summary: "gpt-6-luna", main: "gpt-6.1-sol" },
  anthropic: { summary: "claude-haiku-5-5", main: "claude-sonnet-5-5" },
  google: { summary: "gemini-3.8-flash", main: "gemini-3.1-pro-preview" },
};

/**
 * Get model config for Mastra agents
 */
export function getAgentModelConfig(
  type: "summary" | "main",
  cfg: Config = config,
): {
  id: `${string}/${string}`;
  apiKey: string;
} {
  const provider = cfg.aiProvider;
  const apiKey = cfg.apiKeys[provider];

  if (!apiKey) {
    throw new Error(`API key required for ${provider} provider`);
  }

  return {
    id: `${provider}/${AI_PROVIDER_MODELS[provider][type]}`,
    apiKey,
  };
}

/**
 * Structural interface for the voice provider methods this project uses.
 *
 * We avoid typing against `MastraVoice` directly because its `speak()` return
 * type uses Node's `ReadableStream`, whereas our custom voice providers return
 * web `ReadableStream<Uint8Array>`. Both `XaiVoice` and `OpenAIRealtimeVoice`
 * satisfy this minimal interface.
 *
 * The return type is deliberately `AsyncIterable<unknown>` — both providers
 * return a byte stream in practice, and keeping it minimal decouples the
 * workflow from runtime-specific stream types.
 */
export interface VoiceLike {
  speak(
    input: string,
    options?: Record<string, unknown>,
  ): Promise<AsyncIterable<unknown> | undefined>;
}

/**
 * A configured voice provider plus the provider-specific options to pass
 * to each `speak()` call. This abstracts over OpenAI vs xAI TTS so the
 * workflow doesn't need to know which provider is in use.
 */
export interface VoiceProviderHandle {
  voice: VoiceLike;
  speakOptions: Record<string, unknown>;
}

/** Startup warnings fire once even if the provider is created repeatedly. */
let warnedIgnoredXaiSpeed = false;
let warnedIgnoredOpenAISpeed = false;

/** Reset one-time warning guards (for tests). */
export function resetVoiceProviderWarnings(): void {
  warnedIgnoredXaiSpeed = false;
  warnedIgnoredOpenAISpeed = false;
}

/**
 * Create the configured voice provider for TTS.
 * Supports xAI (default) and OpenAI Realtime (`gpt-realtime-2.1-mini`) via
 * `VOICE_PROVIDER`.
 */
export function createVoiceProvider(cfg: Config = config): VoiceProviderHandle {
  switch (cfg.voiceProvider) {
    case "xai": {
      const apiKey = cfg.apiKeys.xai;
      if (!apiKey) {
        throw new Error("XAI_API_KEY is required for the xAI voice provider");
      }
      if (cfg.openaiVoiceSpeedExplicit && !warnedIgnoredOpenAISpeed) {
        warnedIgnoredOpenAISpeed = true;
        logger.warn`OPENAI_VOICE_SPEED=${cfg.openaiVoiceSpeed} is ignored by the xAI voice path (use XAI_VOICE_SPEED instead)`;
      }
      const voice = new XaiVoice({
        apiKey,
        speaker: cfg.xaiVoiceId,
        language: cfg.xaiVoiceLanguage,
        speed: cfg.xaiVoiceSpeed,
      });
      // xAI TTS has no "instructions"/persona prompt; speed is the main knob.
      return { voice, speakOptions: {} };
    }
    case "openai": {
      const apiKey = cfg.apiKeys.openai;
      if (!apiKey) {
        throw new Error(
          "OPENAI_API_KEY is required for the OpenAI voice provider",
        );
      }
      if (cfg.xaiVoiceSpeedExplicit && !warnedIgnoredXaiSpeed) {
        warnedIgnoredXaiSpeed = true;
        logger.warn`XAI_VOICE_SPEED=${cfg.xaiVoiceSpeed} is ignored by the OpenAI voice path (use OPENAI_VOICE_SPEED instead)`;
      }
      const voice = new OpenAIRealtimeVoice({
        apiKey,
        speaker: cfg.openaiVoiceId,
        speed: cfg.openaiVoiceSpeed,
        instructions: DEFAULT_OPENAI_REALTIME_INSTRUCTIONS,
      });
      return { voice, speakOptions: {} };
    }
    default: {
      const exhaustive: never = cfg.voiceProvider;
      throw new Error(`Unsupported voice provider: ${String(exhaustive)}`);
    }
  }
}

/**
 * xAI TTS understands inline "speech tags" that add natural, human-like
 * delivery (pauses, laughter, whispers, pacing). These are sent verbatim in
 * the text and interpreted by the API. Other providers (e.g. OpenAI) would
 * read such tags aloud as literal words, so this returns guidance only when
 * the xAI voice provider is selected.
 *
 * Returns instructions the script-writing agents can follow, or an empty
 * string when tags are unsupported (so prompts stay unchanged).
 */
export function getSpeechTagGuidance(cfg: Config = config): string {
  if (cfg.voiceProvider !== "xai") return "";

  return `
Delivery tags and vocal performance (IMPORTANT - punctuation and rhythm do most of the work; tags are accents, not wallpaper):
The audio is generated by xAI (Grok) TTS. First make the words themselves sound spoken: vary sentence length, use genuine questions and occasional exclamations, let a reaction land before the next fact, and do not pack every paragraph with the same cadence. Then use inline tags only where a real host would audibly shift energy.

Your permitted toolkit - using any other tag risks it being read aloud literally:
- Pauses and breath: [pause] for a short beat; [long-pause] only at a story transition, before a major reveal, or before the outro; [breath] or [inhale] before a longer explanation; [sigh] for disappointment or resignation.
- Human reactions: [chuckle] for dry amusement; [laugh] only for something genuinely funny (rare). Do not use giggle/cry/mouth-sound tags in this podcast.
- Emphasis and energy: <emphasis>...</emphasis> around one key phrase; <build-intensity>...</build-intensity> leading into a reveal; <decrease-intensity>...</decrease-intensity> for a sobering implication; <loud>...</loud> almost never.
- Pitch and pace: <higher-pitch>...</higher-pitch> for incredulity; <lower-pitch>...</lower-pitch> for gravity; <fast>...</fast> only for a quick aside or compressed list; <slow>...</slow> for one important takeaway.
- Intimacy: <soft>...</soft> for warmth or the sign-off; <whisper>...</whisper> at most once for a conspiratorial aside. Do not use singing tags.

Budgets and placement:
- Aim for roughly 10-18 delivery tags in a full episode, never more than 2 in one paragraph and never stacked back to back.
- Reserve [long-pause] for real chapter breaks: after the intro tease, between story groups, before a major reveal, and before the final reflection. Ordinary paragraph breaks already create short pauses; do not add [pause] to every transition.
- Let punctuation carry ordinary emotion: a real question, a rare exclamation, an em dash, or a short fragment often beats a tag.
- Tags must sit inline within paragraphs, never alone on a line. If a tag is not listed above, do not use it.
`;
}
