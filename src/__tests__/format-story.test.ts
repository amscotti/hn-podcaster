import { assertEquals, assertStringIncludes } from "@std/assert";
import { formatStoryContent } from "../lib/format-story.ts";

Deno.test("formatStoryContent - omits raw article body and comments", () => {
  const formatted = formatStoryContent(
    {
      title: "Cool Project Ships",
      url: "https://example.com/post",
      time: 1_700_000_000,
    },
    "Talking point: the launch matters because X.",
  );

  assertStringIncludes(formatted, "## Cool Project Ships");
  assertStringIncludes(formatted, "URL: https://example.com/post");
  assertStringIncludes(
    formatted,
    "Talking point: the launch matters because X.",
  );
  assertStringIncludes(formatted, "### Summary and Talking Points");

  // Lean payload: no full article / comment sections
  assertEquals(formatted.includes("### Story Text"), false);
  assertEquals(
    formatted.includes("### Hacker News Community Discussion"),
    false,
  );
  assertEquals(formatted.includes("raw article body"), false);
});

Deno.test("formatStoryContent - works without url", () => {
  const formatted = formatStoryContent(
    { title: "No Link", time: 1_700_000_000 },
    "Summary only",
  );
  assertStringIncludes(formatted, "## No Link");
  assertEquals(formatted.includes("URL:"), false);
  assertStringIncludes(formatted, "Summary only");
});
