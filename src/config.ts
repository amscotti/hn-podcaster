const DEFAULT_BASE_URL = "https://api.openai.com/v1";

interface AIModels {
  summary: string;
  main: string;
}

interface GeneralAIConfig {
  apiKey: string | undefined;
  baseURL: string;
  models: AIModels;
}

interface TTSConfig {
  apiKey: string | undefined;
  baseURL: string;
  model: string;
}

interface Config {
  generalAI: GeneralAIConfig;
  tts: TTSConfig;
}

const config: Config = {
  // General AI configuration (can use xAI or other OpenAI-compatible providers)
  generalAI: {
    apiKey: Deno.env.get("GENERAL_AI_API_KEY"),
    baseURL: Deno.env.get("GENERAL_AI_BASE_URL") || DEFAULT_BASE_URL,
    models: {
      summary: Deno.env.get("GENERAL_AI_MODEL_SUMMARY") || "gpt-5-nano",
      main: Deno.env.get("GENERAL_AI_MODEL_MAIN") || "gpt-5",
    },
  },

  // Text-to-Speech configuration (OpenAI only for TTS)
  tts: {
    apiKey: Deno.env.get("OPENAI_API_KEY") || Deno.env.get("TTS_API_KEY"),
    baseURL: Deno.env.get("OPENAI_TTS_BASE_URL") || DEFAULT_BASE_URL,
    model: Deno.env.get("OPENAI_MODEL_TTS") || "gpt-4o-mini-tts",
  },
};

// Validation
function validateConfig() {
  const errors = [];

  if (!config.generalAI.apiKey) {
    errors.push(
      "OPENAI_API_KEY or GENERAL_AI_API_KEY is required for general AI operations.",
    );
  }

  if (!config.tts.apiKey) {
    errors.push(
      "OPENAI_API_KEY or TTS_API_KEY is required for text-to-speech.",
    );
  }

  if (errors.length > 0) {
    console.error("Configuration Error:");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    console.error("\nPlease check your .env file or environment variables.");
    Deno.exit(1);
  }
}

// Validate on module load
validateConfig();

export default config;
