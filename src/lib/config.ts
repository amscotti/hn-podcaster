import { z } from "zod";
import {
  DEFAULT_OPENAI_REALTIME_VOICE,
  DEFAULT_OPENAI_VOICE_SPEED,
  OPENAI_REALTIME_VOICES,
  OPENAI_VOICE_SPEED_MAX,
  OPENAI_VOICE_SPEED_MIN,
} from "./openai-realtime-voice.ts";
import { XAI_VOICE_IDS } from "./xai-voice.ts";

// Voice provider definitions
export const VOICE_PROVIDER_IDS = ["openai", "xai"] as const;
export type VoiceProvider = (typeof VOICE_PROVIDER_IDS)[number];

const VoiceProviderSchema = z.enum(VOICE_PROVIDER_IDS);

// AI Provider definitions
export const AI_PROVIDER_IDS = [
  "xai",
  "openai",
  "anthropic",
  "google",
] as const;
export type AIProvider = (typeof AI_PROVIDER_IDS)[number];

const AIProviderSchema = z.enum(AI_PROVIDER_IDS);

/** Startup warning fires once even if `loadConfig()` runs repeatedly. */
let warnedUnknownVoice = false;

/**
 * Application configuration schema with defaults
 */
const ConfigSchema = z.object({
  // AI Provider settings
  aiProvider: AIProviderSchema.describe("AI provider for text generation"),
  apiKeys: z.object({
    xai: z.string().optional(),
    openai: z.string().optional(),
    anthropic: z.string().optional(),
    google: z.string().optional(),
  }),

  // Podcast generation settings
  storyCount: z
    .number()
    .int()
    .positive()
    .max(50)
    .default(7)
    .describe("Number of HN stories to include (max 50)"),
  improvementIterations: z
    .number()
    .int()
    .min(0)
    .max(10)
    .default(5)
    .describe("Number of script improvement iterations (max 10)"),
  commentCount: z
    .number()
    .int()
    .min(0)
    .max(50)
    .default(25)
    .describe(
      "Number of top HN comments to fetch per story (0 disables, max 50)",
    ),
  targetDurationMinutes: z
    .number()
    .int()
    .min(1)
    .max(120)
    .default(12)
    .describe(
      "Target podcast length in minutes (max 120; drives script word count)",
    ),
  outputDir: z
    .string()
    .min(1)
    .default("./output")
    .describe("Directory for generated files"),
  skipAudio: z
    .boolean()
    .default(false)
    .describe("Skip audio generation (transcript only)"),

  // Voice / TTS settings
  voiceProvider: VoiceProviderSchema.default("xai").describe(
    "TTS provider for audio generation",
  ),
  xaiVoiceId: z
    .string()
    .min(1)
    .default("eve")
    .describe("xAI voice id (any built-in voice, e.g. eve/ara/rex, or custom)"),
  xaiVoiceLanguage: z
    .string()
    .min(1)
    .default("en")
    .describe("BCP-47 language code for xAI TTS (e.g. en, or auto)"),
  xaiVoiceSpeed: z
    .number()
    .min(0.7)
    .max(1.5)
    .default(0.9)
    .describe("xAI TTS speed multiplier (0.7-1.5; 0.9 measured calmer)"),
  xaiVoiceSpeedExplicit: z
    .boolean()
    .default(false)
    .describe("Whether XAI_VOICE_SPEED was explicitly set in the environment"),
  openaiVoiceId: z
    .enum(OPENAI_REALTIME_VOICES)
    .default(DEFAULT_OPENAI_REALTIME_VOICE)
    .describe(
      "OpenAI Realtime GA voice id (alloy, ash, ballad, coral, cedar, echo, marin, sage, shimmer, verse)",
    ),
  openaiVoiceSpeed: z
    .number()
    .min(OPENAI_VOICE_SPEED_MIN)
    .max(OPENAI_VOICE_SPEED_MAX)
    .default(DEFAULT_OPENAI_VOICE_SPEED)
    .describe("OpenAI Realtime TTS speed multiplier (0.25-1.5; default 1.0)"),
  openaiVoiceSpeedExplicit: z
    .boolean()
    .default(false)
    .describe(
      "Whether OPENAI_VOICE_SPEED was explicitly set in the environment",
    ),

  // Content fetching settings
  jinaApiKey: z
    .string()
    .optional()
    .describe(
      "Optional Jina reader API key. When set, blocked article fetches fall back to the Jina reader proxy (https://r.jina.ai)",
    ),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Parse an environment variable as an integer, returning undefined if unset.
 * Present-but-invalid values throw with the variable name and bad value so a
 * typo'd knob is never silently ignored.
 */
export function parseIntEnv(name: string): number | undefined {
  const value = Bun.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (trimmed === "" || !Number.isInteger(parsed)) {
    throw new Error(`Invalid ${name}: "${value}" (expected an integer)`);
  }
  return parsed;
}

/**
 * Parse an environment variable as a float, returning undefined if unset.
 * Present-but-invalid values throw with the variable name and bad value.
 */
export function parseFloatEnv(name: string): number | undefined {
  const value = Bun.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name}: "${value}" (expected a number)`);
  }
  return parsed;
}

/**
 * Parse a boolean environment variable ("true" / "false", case-insensitive,
 * trimmed). Unset or empty values default to false; any other value throws
 * so a typo'd knob is never silently ignored.
 */
export function parseBoolEnv(name: string): boolean {
  const value = Bun.env[name];
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "false") return false;
  if (normalized === "true") return true;
  throw new Error(`Invalid ${name}: "${value}" (expected "true" or "false")`);
}

/**
 * Detect AI provider from environment.
 * Uses explicit AI_PROVIDER if set, otherwise auto-detects from available API keys.
 */
export function detectAIProvider(apiKeys: Config["apiKeys"]): AIProvider {
  const explicit = Bun.env.AI_PROVIDER;

  if (explicit !== undefined) {
    const result = AIProviderSchema.safeParse(explicit);
    if (!result.success) {
      throw new Error(
        `Invalid AI_PROVIDER: "${explicit}". Must be one of: ${AI_PROVIDER_IDS.join(
          ", ",
        )}`,
      );
    }
    return result.data;
  }

  // Auto-detect from available API keys (priority order)
  for (const provider of AI_PROVIDER_IDS) {
    if (apiKeys[provider]) {
      return provider;
    }
  }

  throw new Error(
    `No AI provider configured. Set AI_PROVIDER or provide an API key (XAI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY)`,
  );
}

/** Map provider to its env var name */
const PROVIDER_ENV_KEYS: Record<AIProvider, string> = {
  xai: "XAI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

/**
 * Load and validate configuration from environment variables.
 * Throws if configuration is invalid.
 */
export function loadConfig(): Config {
  // Load API keys
  const apiKeys = {
    xai: Bun.env.XAI_API_KEY,
    openai: Bun.env.OPENAI_API_KEY,
    anthropic: Bun.env.ANTHROPIC_API_KEY,
    google: Bun.env.GOOGLE_GENERATIVE_AI_API_KEY,
  };

  // Check if audio generation is being skipped
  const skipAudio = parseBoolEnv("SKIP_AUDIO");

  // Resolve voice provider (validates VOICE_PROVIDER if set; defaults to xai)
  const voiceProvider = (() => {
    const explicit = Bun.env.VOICE_PROVIDER;
    if (explicit === undefined) return "xai" as const;
    const result = VoiceProviderSchema.safeParse(explicit);
    if (!result.success) {
      throw new Error(
        `Invalid VOICE_PROVIDER: "${explicit}". Must be one of: ${VOICE_PROVIDER_IDS.join(
          ", ",
        )}`,
      );
    }
    return result.data;
  })();

  // A voice provider API key is required for TTS (unless skipping audio)
  if (!skipAudio) {
    if (voiceProvider === "openai" && !apiKeys.openai) {
      throw new Error(
        "OPENAI_API_KEY is required for voice/TTS (or set VOICE_PROVIDER=xai with XAI_API_KEY, or SKIP_AUDIO=true)",
      );
    }
    if (voiceProvider === "xai" && !apiKeys.xai) {
      throw new Error(
        "XAI_API_KEY is required for xAI voice/TTS (or set VOICE_PROVIDER=openai with OPENAI_API_KEY, or SKIP_AUDIO=true)",
      );
    }
  }

  // Detect provider (validates AI_PROVIDER if set)
  const aiProvider = detectAIProvider(apiKeys);

  // Ensure selected provider has an API key
  if (!apiKeys[aiProvider]) {
    throw new Error(
      `${
        PROVIDER_ENV_KEYS[aiProvider]
      } is required when using ${aiProvider} provider`,
    );
  }

  const openaiVoiceId = (() => {
    const explicit = Bun.env.OPENAI_VOICE_ID;
    if (explicit === undefined) return undefined;
    const trimmed = explicit.trim();
    if (!(OPENAI_REALTIME_VOICES as readonly string[]).includes(trimmed)) {
      throw new Error(
        `Invalid OPENAI_VOICE_ID: "${explicit}". Must be one of: ${OPENAI_REALTIME_VOICES.join(", ")}`,
      );
    }
    return trimmed;
  })();

  const xaiVoiceSpeedExplicit = Boolean(Bun.env.XAI_VOICE_SPEED?.trim());
  const openaiVoiceSpeedExplicit = Boolean(Bun.env.OPENAI_VOICE_SPEED?.trim());
  const rawConfig = {
    aiProvider,
    apiKeys,
    storyCount: parseIntEnv("STORY_COUNT"),
    improvementIterations: parseIntEnv("IMPROVEMENT_ITERATIONS"),
    commentCount: parseIntEnv("COMMENT_COUNT"),
    targetDurationMinutes: parseIntEnv("TARGET_DURATION_MINUTES"),
    outputDir: Bun.env.OUTPUT_DIR,
    skipAudio,
    voiceProvider,
    xaiVoiceId: Bun.env.XAI_VOICE_ID,
    xaiVoiceLanguage: Bun.env.XAI_VOICE_LANGUAGE,
    xaiVoiceSpeed: parseFloatEnv("XAI_VOICE_SPEED"),
    xaiVoiceSpeedExplicit,
    openaiVoiceId,
    openaiVoiceSpeed: parseFloatEnv("OPENAI_VOICE_SPEED"),
    openaiVoiceSpeedExplicit,
    jinaApiKey: Bun.env.JINA_API_KEY,
  };

  // Remove undefined values so Zod defaults apply
  const cleanConfig = Object.fromEntries(
    Object.entries(rawConfig).filter(([, v]) => v !== undefined),
  );

  const result = ConfigSchema.safeParse(cleanConfig);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  // Custom voice ids are supported, but a typo'd built-in id is most likely
  // a mistake: warn once at startup with the built-in list, never fail.
  if (result.data.voiceProvider === "xai" && !warnedUnknownVoice) {
    const known = new Set(
      XAI_VOICE_IDS.map((id) => (id as string).toLowerCase()),
    );
    if (!known.has(result.data.xaiVoiceId.toLowerCase())) {
      warnedUnknownVoice = true;
      console.warn(
        `Unknown XAI_VOICE_ID "${result.data.xaiVoiceId}" (built-in voices: ${Array.from(XAI_VOICE_IDS).join(", ")}); assuming a custom voice id`,
      );
    }
  }

  return result.data;
}

/**
 * Validated application configuration.
 * Loaded once at module initialization - will throw if invalid.
 */
export const config: Config = loadConfig();
