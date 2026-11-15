import { expect, test } from "bun:test";
import {
  buildAudioSegments,
  generateAudioStep,
  mapWithConcurrency,
  PERFORMANCE_WINDOW_CONCURRENCY,
} from "../mastra/workflows/podcast-generation.ts";

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
