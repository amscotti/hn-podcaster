import { expect, test } from "bun:test";
import type { Config } from "../lib/config.ts";
import {
  OPENAI_REALTIME_VOICE_MODEL,
  OpenAIRealtimeVoice,
} from "../lib/openai-realtime-voice.ts";
import {
  createVoiceProvider,
  getAgentModelConfig,
  getSpeechTagGuidance,
  resetVoiceProviderWarnings,
} from "../lib/providers.ts";
import { XaiVoice } from "../lib/xai-voice.ts";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    aiProvider: "xai",
    apiKeys: {
      xai: "test-xai-key",
      openai: "test-openai-key",
    },
    storyCount: 7,
    improvementIterations: 5,
    commentCount: 25,
    targetDurationMinutes: 12,
    outputDir: "./output",
    skipAudio: false,
    voiceProvider: "xai",
    xaiVoiceId: "eve",
    xaiVoiceLanguage: "en",
    xaiVoiceSpeed: 0.9,
    xaiVoiceSpeedExplicit: false,
    openaiVoiceId: "marin",
    openaiVoiceSpeed: 1.0,
    openaiVoiceSpeedExplicit: false,
    ...overrides,
  };
}

const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function captureConsoleWarns(fn: () => void): string[] {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    const plain = args
      .map((a) => String(a))
      .join(" ")
      .replace(ANSI_ESCAPE, "");
    warnings.push(plain);
  };
  try {
    fn();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}

test("createVoiceProvider - creates XaiVoice with empty speakOptions and no warnings", () => {
  resetVoiceProviderWarnings();
  const warnings = captureConsoleWarns(() => {
    const handle = createVoiceProvider(makeConfig({ voiceProvider: "xai" }));
    expect(handle.voice).toBeInstanceOf(XaiVoice);
    expect(handle.speakOptions).toEqual({});
  });
  expect(warnings).toEqual([]);
});

test("createVoiceProvider - throws when required voice API key is missing", () => {
  expect(() =>
    createVoiceProvider(
      makeConfig({
        voiceProvider: "xai",
        apiKeys: { xai: undefined, openai: "k" },
      }),
    ),
  ).toThrow(/XAI_API_KEY is required/);
  expect(() =>
    createVoiceProvider(
      makeConfig({
        voiceProvider: "openai",
        apiKeys: { xai: "k", openai: undefined },
      }),
    ),
  ).toThrow(/OPENAI_API_KEY is required/);
});

test("createVoiceProvider - OpenAI creates OpenAIRealtimeVoice with configured voice/speed and no deprecation warning", () => {
  resetVoiceProviderWarnings();
  const cfg = makeConfig({
    voiceProvider: "openai",
    openaiVoiceId: "cedar",
    openaiVoiceSpeed: 1.1,
    xaiVoiceSpeed: 0.9,
    xaiVoiceSpeedExplicit: false,
  });

  const warnings = captureConsoleWarns(() => {
    const handle = createVoiceProvider(cfg);
    expect(handle.voice).toBeInstanceOf(OpenAIRealtimeVoice);
    const realtimeVoice = handle.voice as OpenAIRealtimeVoice;
    expect(realtimeVoice.model).toBe(OPENAI_REALTIME_VOICE_MODEL);
    expect(realtimeVoice.speaker).toBe("cedar");
    expect(realtimeVoice.speed).toBe(1.1);
    expect(handle.speakOptions).toEqual({});
  });

  expect(warnings).toEqual([]);
});

test("createVoiceProvider - OpenAI warns once when XAI_VOICE_SPEED was explicitly set", () => {
  resetVoiceProviderWarnings();
  const cfg = makeConfig({
    voiceProvider: "openai",
    xaiVoiceSpeed: 1.0,
    xaiVoiceSpeedExplicit: true,
  });

  const warnings = captureConsoleWarns(() => {
    createVoiceProvider(cfg);
    createVoiceProvider(cfg);
  });

  const speedWarns = warnings.filter(
    (w) => w.includes("XAI_VOICE_SPEED=1") && w.includes("OPENAI_VOICE_SPEED"),
  );
  expect(speedWarns.length).toBe(1);
});

test("createVoiceProvider - xAI warns once when OPENAI_VOICE_SPEED was explicitly set", () => {
  resetVoiceProviderWarnings();
  const cfg = makeConfig({
    voiceProvider: "xai",
    openaiVoiceSpeed: 1.2,
    openaiVoiceSpeedExplicit: true,
  });

  const warnings = captureConsoleWarns(() => {
    createVoiceProvider(cfg);
    createVoiceProvider(cfg);
  });

  const speedWarns = warnings.filter(
    (w) =>
      w.includes("OPENAI_VOICE_SPEED=1.2") && w.includes("XAI_VOICE_SPEED"),
  );
  expect(speedWarns.length).toBe(1);
});

test("getSpeechTagGuidance - returns guidance for xAI and empty string for OpenAI", () => {
  expect(getSpeechTagGuidance(makeConfig({ voiceProvider: "xai" }))).toContain(
    "[long-pause]",
  );
  expect(getSpeechTagGuidance(makeConfig({ voiceProvider: "openai" }))).toBe(
    "",
  );
});

test("getAgentModelConfig - returns provider/model id and throws when key is missing", () => {
  const cfg = makeConfig({
    aiProvider: "openai",
    apiKeys: { openai: "sk-test" },
  });
  expect(getAgentModelConfig("summary", cfg)).toEqual({
    id: "openai/gpt-6-luna",
    apiKey: "sk-test",
  });
  expect(getAgentModelConfig("main", cfg)).toEqual({
    id: "openai/gpt-6.1-sol",
    apiKey: "sk-test",
  });
  expect(() =>
    getAgentModelConfig(
      "main",
      makeConfig({ aiProvider: "anthropic", apiKeys: {} }),
    ),
  ).toThrow(/API key required for anthropic/);
});
