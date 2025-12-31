import { assertEquals } from "@std/assert";
import { fetchStory, fetchTopStories, type Story } from "../lib/hackernews.ts";

Deno.test("fetchTopStories - valid response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(new Response(JSON.stringify([123, 456, 789])));
  try {
    const result = await fetchTopStories();
    assertEquals(result, [123, 456, 789]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchStory - valid response", async () => {
  const mockStory: Story = {
    id: 123,
    title: "Test Story",
    url: "https://example.com",
    score: 100,
    by: "testuser",
    time: Math.floor(Date.now() / 1000),
    type: "story",
    descendants: 10,
    kids: [124, 125],
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(new Response(JSON.stringify(mockStory)));
  try {
    const result = await fetchStory(123);
    assertEquals(result, mockStory);
    assertEquals(result.id, 123);
    assertEquals(result.title, "Test Story");
    assertEquals(result.type, "story");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchStory - minimal valid response", async () => {
  const minimalStory = {
    id: 123,
    title: "Minimal Story",
    score: 1,
    by: "user",
    time: 1234567890,
    type: "story",
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(new Response(JSON.stringify(minimalStory)));
  try {
    const result = await fetchStory(123);
    assertEquals(result.id, 123);
    assertEquals(result.title, "Minimal Story");
    assertEquals(result.url, undefined); // Optional field
    assertEquals(result.descendants, undefined); // Optional field
    assertEquals(result.kids, undefined); // Optional field
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Story type - proper typing", () => {
  // This test ensures the Story type is properly exported and usable
  const story: Story = {
    id: 123,
    title: "Test Story",
    url: "https://example.com",
    score: 100,
    by: "testuser",
    time: 1234567890,
    type: "story",
    descendants: 10,
    kids: [124, 125],
  };

  assertEquals(story.id, 123);
  assertEquals(story.title, "Test Story");
  assertEquals(story.url, "https://example.com");
  assertEquals(story.score, 100);
  assertEquals(story.by, "testuser");
  assertEquals(story.time, 1234567890);
  assertEquals(story.type, "story");
  assertEquals(story.descendants, 10);
  assertEquals(story.kids, [124, 125]);
});
