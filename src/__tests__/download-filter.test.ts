import { assertEquals } from "@std/assert";
import { keepSuccessfulDownloads } from "../lib/format-story.ts";

Deno.test("keepSuccessfulDownloads - drops empty bodies and caps count", () => {
  const input = [
    { id: 1, text: "full article a" },
    { id: 2, text: "" },
    { id: 3, text: "full article b" },
    { id: 4, text: "   \n  " },
    { id: 5, text: "full article c" },
    { id: 6, text: "full article d" },
  ];

  const { kept, dropped } = keepSuccessfulDownloads(input, 3);

  assertEquals(kept.map((s) => s.id), [1, 3, 5]);
  assertEquals(dropped.map((s) => s.id), [2, 4]);
  assertEquals(kept.length, 3);
});

Deno.test("keepSuccessfulDownloads - fewer successes than target", () => {
  const input = [
    { id: 1, text: "body" },
    { id: 2, text: "" },
  ];
  const { kept, dropped } = keepSuccessfulDownloads(input, 5);
  assertEquals(kept.length, 1);
  assertEquals(dropped.length, 1);
});

Deno.test("keepSuccessfulDownloads - all fail yields empty kept", () => {
  const input = [
    { id: 1, text: "" },
    { id: 2, text: "  " },
    { id: 3, text: "\n" },
  ];
  const { kept, dropped } = keepSuccessfulDownloads(input, 5);
  assertEquals(kept.length, 0);
  assertEquals(dropped.length, 3);
});
