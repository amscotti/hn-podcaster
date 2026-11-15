import { expect, test } from "bun:test";
import { formatStoryContent } from "../lib/format-story.ts";

test("formatStoryContent - omits raw article body and comments", () => {
  const formatted = formatStoryContent(
    {
      title: "Cool Project Ships",
      url: "https://example.com/post",
      time: 1_700_000_000,
    },
    "Talking point: the launch matters because X.",
  );

  expect(formatted).toContain("## Cool Project Ships");
  expect(formatted).toContain("URL: https://example.com/post");
  expect(formatted).toContain("Talking point: the launch matters because X.");
  expect(formatted).toContain("### Summary and Talking Points");

  // Lean payload: no full article / comment sections
  expect(formatted.includes("### Story Text")).toBe(false);
  expect(formatted.includes("### Hacker News Community Discussion")).toBe(
    false,
  );
  expect(formatted.includes("raw article body")).toBe(false);
});

test("formatStoryContent - works without url", () => {
  const formatted = formatStoryContent(
    { title: "No Link", time: 1_700_000_000 },
    "Summary only",
  );
  expect(formatted).toContain("## No Link");
  expect(formatted.includes("URL:")).toBe(false);
  expect(formatted).toContain("Summary only");
});
