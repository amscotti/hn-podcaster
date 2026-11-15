import { expect, test } from "bun:test";
import {
  detectAIProvider,
  loadConfig,
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
  const result = fn();
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
      OUTPUT_DIR: undefined,
    },
    () => {
      const cfg = loadConfig();
      expect(cfg.storyCount).toBe(7);
      expect(cfg.improvementIterations).toBe(5);
      expect(cfg.commentCount).toBe(25);
      expect(cfg.targetDurationMinutes).toBe(12);
      expect(cfg.xaiVoiceSpeed).toBe(0.9);
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
