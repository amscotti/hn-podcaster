import { expect, test } from "bun:test";
import { keepSuccessfulDownloads } from "../lib/format-story.ts";

test("keepSuccessfulDownloads - drops empty bodies and caps count", () => {
  const input = [
    { id: 1, text: "full article a" },
    { id: 2, text: "" },
    { id: 3, text: "full article b" },
    { id: 4, text: "   \n  " },
    { id: 5, text: "full article c" },
    { id: 6, text: "full article d" },
  ];

  const { kept, dropped } = keepSuccessfulDownloads(input, 3);

  expect(kept.map((s) => s.id)).toEqual([1, 3, 5]);
  expect(dropped.map((s) => s.id)).toEqual([2, 4]);
  expect(kept.length).toBe(3);
});

test("keepSuccessfulDownloads - fewer successes than target", () => {
  const input = [
    { id: 1, text: "body" },
    { id: 2, text: "" },
  ];
  const { kept, dropped } = keepSuccessfulDownloads(input, 5);
  expect(kept.length).toBe(1);
  expect(dropped.length).toBe(1);
});

test("keepSuccessfulDownloads - all fail yields empty kept", () => {
  const input = [
    { id: 1, text: "" },
    { id: 2, text: "  " },
    { id: 3, text: "\n" },
  ];
  const { kept, dropped } = keepSuccessfulDownloads(input, 5);
  expect(kept.length).toBe(0);
  expect(dropped.length).toBe(3);
});
