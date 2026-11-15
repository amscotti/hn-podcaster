import { expect, test } from "bun:test";
import { summaryAgent } from "../mastra/agents/summary.ts";
import { downloadContentStep } from "../mastra/steps/download-content.ts";
import {
  buildAudioSegments,
  generateAudioStep,
  generateSummariesStep,
  mapWithConcurrency,
  PERFORMANCE_WINDOW_CONCURRENCY,
  SUGGESTION_CONCURRENCY,
  SUMMARY_CONCURRENCY,
} from "../mastra/workflows/podcast-generation.ts";
import { DOWNLOAD_CONCURRENCY } from "../mastra/steps/download-content.ts";
import { XAI_TTS_MAX_CHARS } from "../lib/script-editing.ts";

test("buildAudioSegments - throws on empty script instead of empty MP3", () => {
  expect(() => buildAudioSegments("", "xai")).toThrow(/empty/);
  expect(() => buildAudioSegments("   \n\n  ", "openai")).toThrow(/empty/);
  expect(buildAudioSegments("Hello world.", "xai").length).toBe(1);
});

test("generateAudioStep - execute rejects empty script before writing files", async () => {
  const execute = generateAudioStep.execute as unknown as (
    args: unknown,
  ) => Promise<unknown>;
  const err = await execute({
    inputData: { script: "", summaries: [], iterationCount: 0 },
  }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toContain("empty");
});

test("buildAudioSegments - later xAI segments stay within the 5200 constant", () => {
  const paragraph = Array.from({ length: 1200 }, () => "word").join(" ");
  const segments = buildAudioSegments(
    `${paragraph}\n\n${paragraph}\n\n${paragraph}`,
    "xai",
  );
  expect(segments.length).toBeGreaterThan(1);
  for (const segment of segments) {
    expect(segment.length).toBeLessThanOrEqual(XAI_TTS_MAX_CHARS);
  }
});

test("generateSummariesStep - caps concurrent summaries at 5, order stable", async () => {
  expect(SUMMARY_CONCURRENCY).toBe(5);
  const originalGenerate = summaryAgent.generate;
  let inFlight = 0;
  let maxInFlight = 0;
  (summaryAgent as unknown as { generate: unknown }).generate = async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Bun.sleep(5);
    inFlight--;
    return { text: "summary text" };
  };
  try {
    const stories = Array.from({ length: 10 }, (_v, i) => ({
      id: i + 1,
      title: `Story ${i + 1}`,
      url: `https://example.com/${i + 1}`,
      score: 10,
      by: "tester",
      time: 1700000000,
      type: "story",
      text: `Article body ${i + 1}.`,
      commentsText: "",
    }));
    const execute = generateSummariesStep.execute as unknown as (
      args: unknown,
    ) => Promise<{ summaries: string[]; storiesWithText: unknown[] }>;
    const out = await execute({ inputData: { storiesWithText: stories } });
    expect(out.summaries.length).toBe(10);
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeGreaterThan(1);
    out.summaries.forEach((summary, i) => {
      expect(summary).toContain(`Story ${i + 1}`);
    });
  } finally {
    (summaryAgent as unknown as { generate: unknown }).generate =
      originalGenerate;
  }
});

test("downloadContentStep - caps concurrent downloads at 5, order stable", async () => {
  expect(DOWNLOAD_CONCURRENCY).toBe(5);
  const originalFetch = globalThis.fetch;
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchStub = async (
    _input: string | URL | Request,
  ): Promise<Response> => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Bun.sleep(5);
    inFlight--;
    return new Response("<html><body><p>Body.</p></body></html>");
  };
  globalThis.fetch = fetchStub as unknown as typeof fetch;
  try {
    const stories = Array.from({ length: 8 }, (_v, i) => ({
      id: i + 1,
      title: `Story ${i + 1}`,
      url: `https://example.com/${i + 1}`,
      score: 10,
      by: "tester",
      time: 1700000000,
      type: "story",
    }));
    const execute = downloadContentStep.execute as unknown as (
      args: unknown,
    ) => Promise<{ storiesWithText: Array<{ id: number }> }>;
    const out = await execute({
      inputData: {
        stories,
        storyCount: 8,
        storyIds: stories.map((s) => s.id),
      },
    });
    expect(out.storiesWithText.length).toBe(8);
    expect(out.storiesWithText.map((s) => s.id)).toEqual(
      stories.map((s) => s.id),
    );
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeGreaterThan(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("suggestion concurrency constant is named and bounded", () => {
  expect(SUGGESTION_CONCURRENCY).toBe(4);
  expect(PERFORMANCE_WINDOW_CONCURRENCY).toBe(4);
});

test("mapWithConcurrency - caps in-flight work at 4 and preserves order", async () => {
  expect(PERFORMANCE_WINDOW_CONCURRENCY).toBe(4);
  const items = Array.from({ length: 10 }, (_v, i) => i);
  let inFlight = 0;
  let maxInFlight = 0;
  const results = await mapWithConcurrency(items, 4, async (item) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Bun.sleep(5);
    inFlight--;
    return item * 2;
  });
  expect(results).toEqual(items.map((i) => i * 2));
  expect(maxInFlight).toBeLessThanOrEqual(4);
  expect(maxInFlight).toBeGreaterThan(1);
  // Empty input is a no-op, not a hang.
  expect(await mapWithConcurrency([], 4, async (x: number) => x)).toEqual([]);
});
