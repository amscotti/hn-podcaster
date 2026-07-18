import { assertEquals } from "@std/assert";
import {
  fetchComments,
  fetchStory,
  fetchTopStories,
  isStoryWithUrl,
  selectStoriesWithUrls,
  type Story,
} from "../lib/hackernews.ts";

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

Deno.test("fetchTopStories - non-ok response throws", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(new Response("nope", { status: 500, statusText: "Error" }));
  try {
    let threw = false;
    try {
      await fetchTopStories();
    } catch (e) {
      threw = true;
      assertEquals(
        e instanceof Error && e.message.includes("Failed to fetch top stories"),
        true,
      );
    }
    assertEquals(threw, true);
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
    assertEquals(result?.id, 123);
    assertEquals(result?.title, "Test Story");
    assertEquals(result?.type, "story");
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
    assertEquals(result?.id, 123);
    assertEquals(result?.title, "Minimal Story");
    assertEquals(result?.url, undefined);
    assertEquals(result?.descendants, undefined);
    assertEquals(result?.kids, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchStory - null item returns null", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response("null", {
        headers: { "Content-Type": "application/json" },
      }),
    );
  try {
    const result = await fetchStory(999);
    assertEquals(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchStory - non-ok HTTP returns null", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(new Response("err", { status: 404 }));
  try {
    const result = await fetchStory(999);
    assertEquals(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchStory - network error returns null", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new TypeError("network down"));
  try {
    const result = await fetchStory(999);
    assertEquals(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("isStoryWithUrl - narrows link stories only", () => {
  const withUrl: Story = {
    id: 1,
    title: "A",
    url: "https://example.com",
    score: 1,
    by: "u",
    time: 1,
    type: "story",
  };
  const askHn: Story = {
    id: 2,
    title: "Ask HN: ?",
    score: 1,
    by: "u",
    time: 1,
    type: "story",
  };
  const job: Story = {
    id: 3,
    title: "Hiring",
    url: "https://example.com/job",
    score: 1,
    by: "u",
    time: 1,
    type: "job",
  };

  assertEquals(isStoryWithUrl(withUrl), true);
  assertEquals(isStoryWithUrl(askHn), false);
  assertEquals(isStoryWithUrl(job), false);
  if (isStoryWithUrl(withUrl)) {
    // url is string after narrowing
    assertEquals(withUrl.url.startsWith("https://"), true);
  }
});

Deno.test("fetchComments - filters deleted and non-comments", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    const id = Number(url.match(/item\/(\d+)/)?.[1]);
    const bodies: Record<number, unknown> = {
      1: {
        id: 1,
        type: "comment",
        by: "alice",
        text: "Great post",
        time: 1,
      },
      2: { id: 2, type: "comment", dead: true, time: 1 }, // no text
      3: { id: 3, type: "story", title: "nope", score: 1, by: "x", time: 1 },
      4: null,
      5: {
        id: 5,
        type: "comment",
        by: "bob",
        text: "Agree",
        time: 2,
      },
    };
    return Promise.resolve(
      new Response(JSON.stringify(bodies[id] ?? null), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  try {
    const comments = await fetchComments([1, 2, 3, 4, 5], 10);
    assertEquals(comments.length, 2);
    assertEquals(comments[0].by, "alice");
    assertEquals(comments[1].by, "bob");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fetchComments - respects limit", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = () => {
    fetchCount++;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: fetchCount,
          type: "comment",
          by: "u",
          text: "hi",
          time: 1,
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
  };
  try {
    const comments = await fetchComments([10, 11, 12, 13], 2);
    assertEquals(comments.length, 2);
    assertEquals(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("selectStoriesWithUrls - backfills past Ask HN posts", async () => {
  const originalFetch = globalThis.fetch;
  const items: Record<number, unknown> = {
    1: {
      id: 1,
      title: "Ask HN: Hello",
      score: 10,
      by: "a",
      time: 1,
      type: "story",
    },
    2: {
      id: 2,
      title: "Real Story",
      url: "https://example.com/a",
      score: 20,
      by: "b",
      time: 2,
      type: "story",
    },
    3: null,
    4: {
      id: 4,
      title: "Another",
      url: "https://example.com/b",
      score: 30,
      by: "c",
      time: 3,
      type: "story",
    },
    5: {
      id: 5,
      title: "Third",
      url: "https://example.com/c",
      score: 40,
      by: "d",
      time: 4,
      type: "story",
    },
  };

  globalThis.fetch = (input) => {
    const url = String(input);
    const id = Number(url.match(/item\/(\d+)/)?.[1]);
    return Promise.resolve(
      new Response(JSON.stringify(items[id] ?? null), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  };

  try {
    const stories = await selectStoriesWithUrls([1, 2, 3, 4, 5], 2);
    assertEquals(stories.length, 2);
    assertEquals(stories[0].id, 2);
    assertEquals(stories[1].id, 4);
    assertEquals(stories[0].url, "https://example.com/a");
    assertEquals(stories[1].url, "https://example.com/b");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("selectStoriesWithUrls - walks multiple batches", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  // 25 items: only every 5th has a URL. Batch size is 10, so this
  // requires at least 3 batches to find 5 URL stories.
  globalThis.fetch = (input) => {
    fetchCount++;
    const url = String(input);
    const id = Number(url.match(/item\/(\d+)/)?.[1]);
    const hasUrl = id % 5 === 0;
    const body = hasUrl
      ? {
        id,
        title: `Story ${id}`,
        url: `https://example.com/${id}`,
        score: id,
        by: "u",
        time: id,
        type: "story",
      }
      : {
        id,
        title: `Ask HN ${id}`,
        score: id,
        by: "u",
        time: id,
        type: "story",
      };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  try {
    const ids = Array.from({ length: 25 }, (_, i) => i + 1);
    const stories = await selectStoriesWithUrls(ids, 5);
    assertEquals(stories.length, 5);
    assertEquals(stories[0].id, 5);
    assertEquals(stories[4].id, 25);
    assertEquals(fetchCount, 25); // consumed all 25 IDs
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("selectStoriesWithUrls - bails early on systemic outage", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  // Every item returns null — simulates a total HN API outage
  globalThis.fetch = () => {
    fetchCount++;
    return Promise.resolve(
      new Response("null", {
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  try {
    // 500 IDs, threshold is 30 consecutive nulls
    const ids = Array.from({ length: 500 }, (_, i) => i + 1);
    const stories = await selectStoriesWithUrls(ids, 10);
    assertEquals(stories.length, 0);
    // Should stop well before all 500 IDs
    assertEquals(fetchCount <= 30, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Story type - proper typing", () => {
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
