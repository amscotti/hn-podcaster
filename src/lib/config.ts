import { z } from "@zod/zod";

// AI Provider definitions
export const AI_PROVIDER_IDS = [
  "xai",
  "openai",
  "anthropic",
  "google",
] as const;
export type AIProvider = (typeof AI_PROVIDER_IDS)[number];

const AIProviderSchema = z.enum(AI_PROVIDER_IDS);

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
    .default(10)
    .describe("Number of HN stories to include"),
  improvementIterations: z
    .number()
    .int()
    .min(0)
    .default(5)
    .describe("Number of script improvement iterations"),
  outputDir: z
    .string()
    .min(1)
    .default("./output")
    .describe("Directory for generated files"),
  skipAudio: z
    .boolean()
    .default(false)
    .describe("Skip audio generation (transcript only)"),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Parse an environment variable as an integer, returning undefined if not set or invalid
 */
function parseIntEnv(name: string): number | undefined {
  const value = Deno.env.get(name);
  if (value === undefined) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Detect AI provider from environment.
 * Uses explicit AI_PROVIDER if set, otherwise auto-detects from available API keys.
 */
function detectAIProvider(apiKeys: Config["apiKeys"]): AIProvider {
  const explicit = Deno.env.get("AI_PROVIDER");

  if (explicit !== undefined) {
    const result = AIProviderSchema.safeParse(explicit);
    if (!result.success) {
      throw new Error(
        `Invalid AI_PROVIDER: "${explicit}". Must be one of: ${
          AI_PROVIDER_IDS.join(", ")
        }`,
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
function loadConfig(): Config {
  // Load API keys
  const apiKeys = {
    xai: Deno.env.get("XAI_API_KEY"),
    openai: Deno.env.get("OPENAI_API_KEY"),
    anthropic: Deno.env.get("ANTHROPIC_API_KEY"),
    google: Deno.env.get("GOOGLE_GENERATIVE_AI_API_KEY"),
  };

  // Check if audio generation is being skipped
  const skipAudio = Deno.env.get("SKIP_AUDIO")?.toLowerCase() === "true";

  // OpenAI is required for voice/TTS (unless skipping audio)
  if (!apiKeys.openai && !skipAudio) {
    throw new Error(
      "OPENAI_API_KEY is required for voice/TTS (or set SKIP_AUDIO=true)",
    );
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

  const rawConfig = {
    aiProvider,
    apiKeys,
    storyCount: parseIntEnv("STORY_COUNT"),
    improvementIterations: parseIntEnv("IMPROVEMENT_ITERATIONS"),
    outputDir: Deno.env.get("OUTPUT_DIR"),
    skipAudio,
  };

  // Remove undefined values so Zod defaults apply
  const cleanConfig = Object.fromEntries(
    Object.entries(rawConfig).filter(([_, v]) => v !== undefined),
  );

  const result = ConfigSchema.safeParse(cleanConfig);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return result.data;
}

/**
 * Validated application configuration.
 * Loaded once at module initialization - will throw if invalid.
 */
export const config: Config = loadConfig();
