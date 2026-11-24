import { expect, test } from "bun:test";
import {
  COMMENT_FETCH_CONCURRENCY,
  fetchComments,
  fetchStory,
  fetchTopStories,
  isStoryWithUrl,
  type Story,
  StorySchema,
  StoryWithUrlSchema,
  selectStoriesWithUrls,
} from "../lib/hackernews.ts";

type FetchStub = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function stubFetch(impl: FetchStub): void {
  globalThis.fetch = impl as unknown as typeof fetch;
}

test("fetchTopStories - valid response", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch(() =>
    Promise.resolve(new Response(JSON.stringify([123, 456, 789]))),
  );
  try {
    const result = await fetchTopStories();
    expect(result).toEqual([123, 456, 789]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchTopStories - non-ok response throws", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch(() =>
    Promise.resolve(new Response("nope", { status: 500, statusText: "Error" })),
  );
  try {
    const err = await fetchTopStories().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("Failed to fetch top stories");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchStory - valid response", async () => {
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
  stubFetch(() => Promise.resolve(new Response(JSON.stringify(mockStory))));
  try {
    const result = await fetchStory(123);
    expect(result).toEqual(mockStory);
    expect(result?.id).toBe(123);
    expect(result?.title).toBe("Test Story");
    expect(result?.type).toBe("story");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchStory - minimal valid response", async () => {
  const minimalStory = {
    id: 123,
    title: "Minimal Story",
    score: 1,
    by: "user",
    time: 1234567890,
    type: "story",
  };

  const originalFetch = globalThis.fetch;
  stubFetch(() => Promise.resolve(new Response(JSON.stringify(minimalStory))));
  try {
    const result = await fetchStory(123);
    expect(result?.id).toBe(123);
    expect(result?.title).toBe("Minimal Story");
    expect(result?.url).toBeUndefined();
    expect(result?.descendants).toBeUndefined();
    expect(result?.kids).toBeUndefined();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchStory - null item returns null", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch(() =>
    Promise.resolve(
      new Response("null", {
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  try {
    const result = await fetchStory(999);
    expect(result).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchStory - non-ok HTTP returns null", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch(() => Promise.resolve(new Response("err", { status: 404 })));
  try {
    const result = await fetchStory(999);
    expect(result).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchStory - network error returns null", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch(() => Promise.reject(new TypeError("network down")));
  try {
    const result = await fetchStory(999);
    expect(result).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("isStoryWithUrl - narrows link stories only", () => {
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

  expect(isStoryWithUrl(withUrl)).toBe(true);
  expect(isStoryWithUrl(askHn)).toBe(false);
  expect(isStoryWithUrl(job)).toBe(false);
  if (isStoryWithUrl(withUrl)) {
    // url is string after narrowing
    expect(withUrl.url.startsWith("https://")).toBe(true);
  }
});

test("fetchComments - filters deleted and non-comments", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch((input) => {
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
  });
  try {
    const comments = await fetchComments([1, 2, 3, 4, 5], 10);
    expect(comments.length).toBe(2);
    expect(comments[0].by).toBe("alice");
    expect(comments[1].by).toBe("bob");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchComments - respects limit", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  stubFetch(() => {
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
  });
  try {
    const comments = await fetchComments([10, 11, 12, 13], 2);
    expect(comments.length).toBe(2);
    expect(fetchCount).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("selectStoriesWithUrls - backfills past Ask HN posts", async () => {
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

  stubFetch((input) => {
    const url = String(input);
    const id = Number(url.match(/item\/(\d+)/)?.[1]);
    return Promise.resolve(
      new Response(JSON.stringify(items[id] ?? null), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  try {
    const stories = await selectStoriesWithUrls([1, 2, 3, 4, 5], 2);
    expect(stories.length).toBe(2);
    expect(stories[0].id).toBe(2);
    expect(stories[1].id).toBe(4);
    expect(stories[0].url).toBe("https://example.com/a");
    expect(stories[1].url).toBe("https://example.com/b");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("selectStoriesWithUrls - walks multiple batches", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  // 25 items: only every 5th has a URL. Batch size is 10, so this
  // requires at least 3 batches to find 5 URL stories.
  stubFetch((input) => {
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
  });
  try {
    const ids = Array.from({ length: 25 }, (_, i) => i + 1);
    const stories = await selectStoriesWithUrls(ids, 5);
    expect(stories.length).toBe(5);
    expect(stories[0].id).toBe(5);
    expect(stories[4].id).toBe(25);
    expect(fetchCount).toBe(25); // consumed all 25 IDs
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("selectStoriesWithUrls - bails early on systemic outage", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  // Every item returns null — simulates a total HN API outage
  stubFetch(() => {
    fetchCount++;
    return Promise.resolve(
      new Response("null", {
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  try {
    // 500 IDs, threshold is 30 consecutive nulls
    const ids = Array.from({ length: 500 }, (_, i) => i + 1);
    const stories = await selectStoriesWithUrls(ids, 10);
    expect(stories.length).toBe(0);
    // Should stop well before all 500 IDs
    expect(fetchCount <= 30).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Story schema - runtime guard accepts link stories, rejects bad items", () => {
  const link = {
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
  expect(StorySchema.safeParse(link).success).toBe(true);
  expect(StoryWithUrlSchema.safeParse(link).success).toBe(true);
  // Missing required fields and missing url (for the link schema) fail.
  expect(StorySchema.safeParse({ id: 1 }).success).toBe(false);
  expect(
    StoryWithUrlSchema.safeParse({
      id: 1,
      title: "No link",
      score: 1,
      by: "u",
      time: 1,
      type: "story",
    }).success,
  ).toBe(false);
  // Failed fetch payloads must not pass as stories.
  expect(StorySchema.safeParse(null).success).toBe(false);
  expect(StorySchema.safeParse("x").success).toBe(false);
});

test("isStoryWithUrl - rejects non-http(s) and malformed URL schemes", () => {
  const base: Story = {
    id: 1,
    title: "Scheme test",
    score: 10,
    by: "u",
    time: 1,
    type: "story",
  };
  expect(isStoryWithUrl({ ...base, url: "http://example.com/post" })).toBe(
    true,
  );
  expect(isStoryWithUrl({ ...base, url: "HTTPS://example.com/post" })).toBe(
    true,
  );
  expect(isStoryWithUrl({ ...base, url: "javascript:alert(1)" })).toBe(false);
  expect(isStoryWithUrl({ ...base, url: "ftp://example.com/file" })).toBe(
    false,
  );
  expect(isStoryWithUrl({ ...base, url: "data:text/html,hi" })).toBe(false);
  expect(isStoryWithUrl({ ...base, url: "file:///etc/passwd" })).toBe(false);
  expect(isStoryWithUrl({ ...base, url: "not a url" })).toBe(false);
  expect(isStoryWithUrl({ ...base, url: "" })).toBe(false);
});

test("fetchComments - filters dead/deleted items even with text and soft-skips malformed siblings", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch((input) => {
    const url = String(input);
    const id = Number(url.match(/item\/(\d+)/)?.[1]);
    const bodies: Record<number, unknown> = {
      1: {
        id: 1,
        type: "comment",
        by: "alice",
        text: "Valid first",
        time: 1,
      },
      2: {
        id: 2,
        type: "comment",
        by: "spammer",
        text: "Killed comment that still carries text",
        dead: true,
        time: 2,
      },
      3: {
        id: 3,
        type: "comment",
        by: "ghost",
        text: "Deleted comment that still carries text",
        deleted: true,
        time: 3,
      },
      4: {
        // Malformed: missing required numeric id and time
        type: "comment",
        text: "Broken schema item",
      },
      5: {
        id: 5,
        type: "comment",
        by: "bob",
        text: "Valid second",
        time: 5,
      },
    };
    return Promise.resolve(
      new Response(JSON.stringify(bodies[id] ?? null), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  try {
    const comments = await fetchComments([1, 2, 3, 4, 5], 10);
    expect(comments.map((c) => c.id)).toEqual([1, 5]);
    expect(comments.map((c) => c.text)).toEqual([
      "Valid first",
      "Valid second",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchComments - bounds concurrent fetches and preserves order", async () => {
  const originalFetch = globalThis.fetch;
  let inFlight = 0;
  let maxInFlight = 0;
  stubFetch(async (input) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const id = Number(String(input).match(/item\/(\d+)/)?.[1]);
    await Bun.sleep(5);
    inFlight--;
    return new Response(
      JSON.stringify({
        id,
        type: "comment",
        by: `user${id}`,
        text: `Comment ${id}`,
        time: id,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  });
  try {
    const ids = Array.from({ length: 25 }, (_, i) => i + 1);
    const comments = await fetchComments(ids, 25);
    expect(comments.map((c) => c.id)).toEqual(ids);
    expect(maxInFlight).toBeLessThanOrEqual(COMMENT_FETCH_CONCURRENCY);
    expect(maxInFlight).toBeGreaterThan(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HN fetchers - cancel response body on non-ok HTTP responses", async () => {
  const originalFetch = globalThis.fetch;
  let cancelCount = 0;
  const makeErrorResponse = (): Response => {
    const body = new ReadableStream<Uint8Array>({
      start() {
        // Stalled error body until canceled
      },
      cancel() {
        cancelCount++;
      },
    });
    return new Response(body, { status: 503, statusText: "Unavailable" });
  };

  stubFetch(() => Promise.resolve(makeErrorResponse()));
  try {
    await fetchTopStories().catch(() => {});
    expect(cancelCount).toBe(1);

    const story = await fetchStory(42);
    expect(story).toBeNull();
    expect(cancelCount).toBe(2);

    const comments = await fetchComments([101, 102], 2);
    expect(comments).toEqual([]);
    expect(cancelCount).toBe(4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
