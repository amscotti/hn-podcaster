import { expect, test } from "bun:test";
import {
  detectAIProvider,
  loadConfig,
  parseBoolEnv,
  parseFloatEnv,
  parseIntEnv,
} from "../lib/config.ts";

function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> | void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(Bun.env)) {
    saved[key] = Bun.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete (Bun.env as Record<string, string | undefined>)[key];
    } else {
      (Bun.env as Record<string, string | undefined>)[key] = value;
    }
  }
  const restore = (): void => {
    for (const key of Object.keys(Bun.env)) {
      if (!(key in saved)) {
        delete (Bun.env as Record<string, string | undefined>)[key];
      }
    }
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete (Bun.env as Record<string, string | undefined>)[key];
      } else {
        (Bun.env as Record<string, string | undefined>)[key] = value;
      }
    }
  };
  let result: void | Promise<void>;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  if (result instanceof Promise) {
    return result.finally(restore);
  }
  restore();
  return undefined;
}

// Base env that lets loadConfig succeed without relying on .env contents.
const BASE_ENV: Record<string, string | undefined> = {
  AI_PROVIDER: "xai",
  XAI_API_KEY: "test-xai-key",
  VOICE_PROVIDER: "xai",
  SKIP_AUDIO: undefined,
  JINA_API_KEY: undefined,
};

test("parseIntEnv - returns undefined when unset, value when set", () => {
  withEnv({ STORY_COUNT: undefined }, () => {
    expect(parseIntEnv("STORY_COUNT")).toBeUndefined();
  });
  withEnv({ STORY_COUNT: "7" }, () => {
    expect(parseIntEnv("STORY_COUNT")).toBe(7);
  });
});

test("parseIntEnv - throws with variable name and bad value on invalid", () => {
  withEnv({ STORY_COUNT: "abc" }, () => {
    const err = (() => {
      try {
        parseIntEnv("STORY_COUNT");
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("STORY_COUNT");
    expect((err as Error).message).toContain("abc");
  });
  withEnv({ STORY_COUNT: "3.5" }, () => {
    expect(() => parseIntEnv("STORY_COUNT")).toThrow(/STORY_COUNT.*3\.5/);
  });
  withEnv({ STORY_COUNT: "" }, () => {
    expect(() => parseIntEnv("STORY_COUNT")).toThrow(/STORY_COUNT/);
  });
});

test("parseFloatEnv - throws with variable name and bad value on invalid", () => {
  withEnv({ XAI_VOICE_SPEED: "fast" }, () => {
    const err = (() => {
      try {
        parseFloatEnv("XAI_VOICE_SPEED");
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("XAI_VOICE_SPEED");
    expect((err as Error).message).toContain("fast");
  });
  withEnv({ XAI_VOICE_SPEED: "0.9" }, () => {
    expect(parseFloatEnv("XAI_VOICE_SPEED")).toBe(0.9);
  });
});

test("detectAIProvider - prefers explicit AI_PROVIDER, validates it", () => {
  withEnv({ AI_PROVIDER: "openai" }, () => {
    expect(
      detectAIProvider({ xai: "k", openai: "k" } as Parameters<
        typeof detectAIProvider
      >[0]),
    ).toBe("openai");
  });
  withEnv({ AI_PROVIDER: "bogus" }, () => {
    expect(() =>
      detectAIProvider({ xai: "k" } as Parameters<typeof detectAIProvider>[0]),
    ).toThrow(/Invalid AI_PROVIDER.*bogus/);
  });
});

test("detectAIProvider - auto-detects from keys in priority order", () => {
  withEnv({ AI_PROVIDER: undefined }, () => {
    expect(
      detectAIProvider({
        xai: undefined,
        openai: "k",
        anthropic: "k",
      } as Parameters<typeof detectAIProvider>[0]),
    ).toBe("openai");
    expect(
      detectAIProvider({
        xai: "k",
        openai: "k",
      } as Parameters<typeof detectAIProvider>[0]),
    ).toBe("xai");
  });
  withEnv({ AI_PROVIDER: undefined }, () => {
    expect(() =>
      detectAIProvider({} as Parameters<typeof detectAIProvider>[0]),
    ).toThrow(/No AI provider configured/);
  });
});

test("loadConfig - happy path keeps documented defaults", () => {
  withEnv(
    {
      ...BASE_ENV,
      STORY_COUNT: undefined,
      IMPROVEMENT_ITERATIONS: undefined,
      COMMENT_COUNT: undefined,
      TARGET_DURATION_MINUTES: undefined,
      XAI_VOICE_SPEED: undefined,
      OPENAI_VOICE_ID: undefined,
      OPENAI_VOICE_SPEED: undefined,
      OUTPUT_DIR: undefined,
    },
    () => {
      const cfg = loadConfig();
      expect(cfg.storyCount).toBe(7);
      expect(cfg.improvementIterations).toBe(5);
      expect(cfg.commentCount).toBe(25);
      expect(cfg.targetDurationMinutes).toBe(12);
      expect(cfg.xaiVoiceSpeed).toBe(0.9);
      expect(cfg.openaiVoiceId).toBe("marin");
      expect(cfg.openaiVoiceSpeed).toBe(1.0);
      expect(cfg.openaiVoiceSpeedExplicit).toBe(false);
      expect(cfg.voiceProvider).toBe("xai");
      expect(cfg.aiProvider).toBe("xai");
    },
  );
});

test("loadConfig - rejects out-of-bounds knobs", () => {
  withEnv({ ...BASE_ENV, STORY_COUNT: "51" }, () => {
    expect(() => loadConfig()).toThrow(/Invalid configuration/);
  });
  withEnv({ ...BASE_ENV, IMPROVEMENT_ITERATIONS: "11" }, () => {
    expect(() => loadConfig()).toThrow(/Invalid configuration/);
  });
  withEnv({ ...BASE_ENV, COMMENT_COUNT: "51" }, () => {
    expect(() => loadConfig()).toThrow(/Invalid configuration/);
  });
  withEnv({ ...BASE_ENV, TARGET_DURATION_MINUTES: "121" }, () => {
    expect(() => loadConfig()).toThrow(/Invalid configuration/);
  });
});

test("loadConfig - fails loudly on invalid numerics instead of defaulting", () => {
  withEnv({ ...BASE_ENV, STORY_COUNT: "abc" }, () => {
    expect(() => loadConfig()).toThrow(/STORY_COUNT.*abc/);
  });
  withEnv({ ...BASE_ENV, XAI_VOICE_SPEED: "fast" }, () => {
    expect(() => loadConfig()).toThrow(/XAI_VOICE_SPEED.*fast/);
  });
});

test("loadConfig - throws when selected provider key is missing", () => {
  withEnv(
    {
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: undefined,
      XAI_API_KEY: "k",
      VOICE_PROVIDER: "xai",
    },
    () => {
      expect(() => loadConfig()).toThrow(/OPENAI_API_KEY is required/);
    },
  );
});

test("withEnv - restores Bun.env even when callback throws synchronously", () => {
  const previous = Bun.env.STORY_COUNT;
  expect(() =>
    withEnv({ STORY_COUNT: "99", TEST_ONLY_TEMP_VAR: "leaked" }, () => {
      expect(Bun.env.STORY_COUNT).toBe("99");
      expect(Bun.env.TEST_ONLY_TEMP_VAR).toBe("leaked");
      throw new Error("boom");
    }),
  ).toThrow("boom");
  expect(Bun.env.STORY_COUNT).toBe(previous);
  expect(Bun.env.TEST_ONLY_TEMP_VAR).toBeUndefined();
});

test("parseBoolEnv - trims, handles empty/false/true, rejects typos", () => {
  withEnv({ SKIP_AUDIO: undefined }, () => {
    expect(parseBoolEnv("SKIP_AUDIO")).toBe(false);
  });
  withEnv({ SKIP_AUDIO: "" }, () => {
    expect(parseBoolEnv("SKIP_AUDIO")).toBe(false);
  });
  withEnv({ SKIP_AUDIO: "   " }, () => {
    expect(parseBoolEnv("SKIP_AUDIO")).toBe(false);
  });
  withEnv({ SKIP_AUDIO: " true " }, () => {
    expect(parseBoolEnv("SKIP_AUDIO")).toBe(true);
  });
  withEnv({ SKIP_AUDIO: "TRUE" }, () => {
    expect(parseBoolEnv("SKIP_AUDIO")).toBe(true);
  });
  withEnv({ SKIP_AUDIO: " False " }, () => {
    expect(parseBoolEnv("SKIP_AUDIO")).toBe(false);
  });
  withEnv({ SKIP_AUDIO: "1" }, () => {
    expect(() => parseBoolEnv("SKIP_AUDIO")).toThrow(/Invalid SKIP_AUDIO.*"1"/);
  });
  withEnv({ SKIP_AUDIO: "yes" }, () => {
    expect(() => parseBoolEnv("SKIP_AUDIO")).toThrow(
      /Invalid SKIP_AUDIO.*"yes"/,
    );
  });
});

test("loadConfig - VOICE_PROVIDER validation and missing voice key hints", () => {
  withEnv({ ...BASE_ENV, VOICE_PROVIDER: "elevenlabs" }, () => {
    expect(() => loadConfig()).toThrow(/Invalid VOICE_PROVIDER.*elevenlabs/);
  });
  withEnv(
    {
      ...BASE_ENV,
      VOICE_PROVIDER: "openai",
      OPENAI_API_KEY: "test-openai-key",
    },
    () => {
      const cfg = loadConfig();
      expect(cfg.voiceProvider).toBe("openai");
    },
  );
  withEnv(
    {
      ...BASE_ENV,
      VOICE_PROVIDER: "openai",
      OPENAI_API_KEY: undefined,
    },
    () => {
      expect(() => loadConfig()).toThrow(
        /OPENAI_API_KEY is required.*VOICE_PROVIDER=xai/,
      );
    },
  );
  withEnv(
    {
      ...BASE_ENV,
      AI_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "test-anthropic-key",
      XAI_API_KEY: undefined,
      VOICE_PROVIDER: "xai",
      SKIP_AUDIO: undefined,
    },
    () => {
      expect(() => loadConfig()).toThrow(
        /XAI_API_KEY is required.*VOICE_PROVIDER=openai with OPENAI_API_KEY/,
      );
    },
  );
});

test("loadConfig - SKIP_AUDIO=true bypasses voice key check and trims whitespace", () => {
  withEnv(
    {
      ...BASE_ENV,
      AI_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "test-anthropic-key",
      XAI_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
      VOICE_PROVIDER: "xai",
      SKIP_AUDIO: " true ",
    },
    () => {
      const cfg = loadConfig();
      expect(cfg.skipAudio).toBe(true);
      expect(cfg.aiProvider).toBe("anthropic");
    },
  );
  withEnv({ ...BASE_ENV, SKIP_AUDIO: "notabool" }, () => {
    expect(() => loadConfig()).toThrow(/Invalid SKIP_AUDIO/);
  });
});

test("loadConfig - tracks xaiVoiceSpeedExplicit and enforces speed & lower bounds", () => {
  withEnv({ ...BASE_ENV, XAI_VOICE_SPEED: undefined }, () => {
    const cfg = loadConfig();
    expect(cfg.xaiVoiceSpeed).toBe(0.9);
    expect(cfg.xaiVoiceSpeedExplicit).toBe(false);
  });
  withEnv({ ...BASE_ENV, XAI_VOICE_SPEED: "0.9" }, () => {
    const cfg = loadConfig();
    expect(cfg.xaiVoiceSpeed).toBe(0.9);
    expect(cfg.xaiVoiceSpeedExplicit).toBe(true);
  });
  withEnv({ ...BASE_ENV, XAI_VOICE_SPEED: "0.7" }, () => {
    expect(loadConfig().xaiVoiceSpeed).toBe(0.7);
  });
  withEnv({ ...BASE_ENV, XAI_VOICE_SPEED: "1.5" }, () => {
    expect(loadConfig().xaiVoiceSpeed).toBe(1.5);
  });
  withEnv({ ...BASE_ENV, XAI_VOICE_SPEED: "0.69" }, () => {
    expect(() => loadConfig()).toThrow(/Invalid configuration/);
  });
  withEnv({ ...BASE_ENV, XAI_VOICE_SPEED: "1.51" }, () => {
    expect(() => loadConfig()).toThrow(/Invalid configuration/);
  });
  withEnv({ ...BASE_ENV, STORY_COUNT: "0" }, () => {
    expect(() => loadConfig()).toThrow(/Invalid configuration/);
  });
  withEnv({ ...BASE_ENV, TARGET_DURATION_MINUTES: "0" }, () => {
    expect(() => loadConfig()).toThrow(/Invalid configuration/);
  });
  withEnv({ ...BASE_ENV, IMPROVEMENT_ITERATIONS: "-1" }, () => {
    expect(() => loadConfig()).toThrow(/Invalid configuration/);
  });
  withEnv({ ...BASE_ENV, COMMENT_COUNT: "-1" }, () => {
    expect(() => loadConfig()).toThrow(/Invalid configuration/);
  });
});

test("loadConfig - validates OPENAI_VOICE_ID and OPENAI_VOICE_SPEED", () => {
  withEnv(
    {
      ...BASE_ENV,
      OPENAI_VOICE_ID: undefined,
      OPENAI_VOICE_SPEED: undefined,
    },
    () => {
      const cfg = loadConfig();
      expect(cfg.openaiVoiceId).toBe("marin");
      expect(cfg.openaiVoiceSpeed).toBe(1.0);
      expect(cfg.openaiVoiceSpeedExplicit).toBe(false);
    },
  );
  withEnv(
    {
      ...BASE_ENV,
      OPENAI_VOICE_ID: "cedar",
      OPENAI_VOICE_SPEED: "0.25",
    },
    () => {
      const cfg = loadConfig();
      expect(cfg.openaiVoiceId).toBe("cedar");
      expect(cfg.openaiVoiceSpeed).toBe(0.25);
      expect(cfg.openaiVoiceSpeedExplicit).toBe(true);
    },
  );
  withEnv({ ...BASE_ENV, OPENAI_VOICE_SPEED: "1.5" }, () => {
    expect(loadConfig().openaiVoiceSpeed).toBe(1.5);
  });
  withEnv({ ...BASE_ENV, OPENAI_VOICE_ID: "nova" }, () => {
    expect(() => loadConfig()).toThrow(/Invalid OPENAI_VOICE_ID.*"nova"/);
  });
  withEnv({ ...BASE_ENV, OPENAI_VOICE_ID: "" }, () => {
    expect(() => loadConfig()).toThrow(/Invalid OPENAI_VOICE_ID/);
  });
  withEnv({ ...BASE_ENV, OPENAI_VOICE_SPEED: "0.24" }, () => {
    expect(() => loadConfig()).toThrow(/Invalid configuration/);
  });
  withEnv({ ...BASE_ENV, OPENAI_VOICE_SPEED: "1.51" }, () => {
    expect(() => loadConfig()).toThrow(/Invalid configuration/);
  });
  withEnv({ ...BASE_ENV, OPENAI_VOICE_SPEED: "fast" }, () => {
    expect(() => loadConfig()).toThrow(/OPENAI_VOICE_SPEED.*fast/);
  });
});
