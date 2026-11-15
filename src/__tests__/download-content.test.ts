import { expect, test } from "bun:test";
import {
  downloadAndExtract,
  extractHtmlText,
  fetchArticleText,
  fetchViaJina,
  isPdfBuffer,
  MAX_DOWNLOAD_BYTES,
} from "../mastra/steps/download-content.ts";

type FetchStub = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function stubFetch(impl: FetchStub): void {
  globalThis.fetch = impl as unknown as typeof fetch;
}

const MINIMAL_PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 100 700 Td (Hello PDF) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";

test("isPdfBuffer - magic bytes distinguish PDF from HTML", () => {
  expect(isPdfBuffer(new TextEncoder().encode(MINIMAL_PDF).buffer)).toBe(true);
  expect(isPdfBuffer(new TextEncoder().encode("<html>hi</html>").buffer)).toBe(
    false,
  );
  expect(isPdfBuffer(new ArrayBuffer(0))).toBe(false);
});

test("extractHtmlText - strips HTML to plain text", () => {
  const html =
    "<html><body><p>Hello world</p><p>Second para.</p></body></html>";
  const text = extractHtmlText(new TextEncoder().encode(html).buffer);
  expect(text).toContain("Hello world");
  expect(text).toContain("Second para.");
  expect(text).not.toContain("<p>");
});

test("downloadAndExtract - HTML route returns extracted text", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch(() =>
    Promise.resolve(
      new Response("<html><body><p>Article body here.</p></body></html>"),
    ),
  );
  try {
    const text = await downloadAndExtract("https://example.com/a", 0, 1);
    expect(text).toContain("Article body here.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("downloadAndExtract - PDF route extracts PDF text", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch(() => Promise.resolve(new Response(MINIMAL_PDF)));
  try {
    const text = await downloadAndExtract("https://example.com/doc", 0, 1);
    expect(text).toContain("Hello PDF");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("downloadAndExtract - retries 503 then succeeds, does not retry 400", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  stubFetch(() => {
    calls++;
    if (calls === 1) {
      return Promise.resolve(
        new Response("busy", { status: 503, statusText: "Unavailable" }),
      );
    }
    return Promise.resolve(
      new Response("<html><body><p>Recovered.</p></body></html>"),
    );
  });
  try {
    const text = await downloadAndExtract("https://example.com/r", 2, 1);
    expect(text).toContain("Recovered.");
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
  }

  calls = 0;
  stubFetch(() => {
    calls++;
    return Promise.resolve(
      new Response("nope", { status: 400, statusText: "Bad Request" }),
    );
  });
  try {
    const err = await downloadAndExtract("https://example.com/b", 2, 1).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("400");
    expect(calls).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchViaJina - returns Jina markdown via proxy URL", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  stubFetch((input) => {
    seenUrl = String(input);
    return Promise.resolve(new Response("Jina markdown here"));
  });
  try {
    const text = await fetchViaJina("https://example.com/blocked");
    expect(text).toBe("Jina markdown here");
    expect(seenUrl.startsWith("https://r.jina.ai/")).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchArticleText - falls back to Jina on direct 403", async () => {
  const originalFetch = globalThis.fetch;
  const seenUrls: string[] = [];
  stubFetch((input) => {
    const url = String(input);
    seenUrls.push(url);
    if (url.startsWith("https://r.jina.ai/")) {
      return Promise.resolve(new Response("Rescued via Jina."));
    }
    return Promise.resolve(
      new Response("forbidden", { status: 403, statusText: "Forbidden" }),
    );
  });
  try {
    const text = await fetchArticleText("https://example.com/blocked");
    expect(text).toBe("Rescued via Jina.");
    expect(seenUrls.length).toBe(2);
    expect(seenUrls[1].startsWith("https://r.jina.ai/")).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("downloadAndExtract - size cap fails fast on oversized Content-Length", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  stubFetch(() => {
    calls++;
    return Promise.resolve(
      new Response("tiny", {
        headers: { "Content-Length": String(MAX_DOWNLOAD_BYTES + 1) },
      }),
    );
  });
  try {
    const err = await downloadAndExtract(
      "https://example.com/huge",
      2,
      1,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("15 MB cap");
    // Cap failures are not transient: exactly one fetch, no retry.
    expect(calls).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("downloadAndExtract - size cap aborts streamed body over the cap", async () => {
  const originalFetch = globalThis.fetch;
  stubFetch(() => {
    const big = new Uint8Array(MAX_DOWNLOAD_BYTES + 1);
    return Promise.resolve(new Response(big));
  });
  try {
    const err = await downloadAndExtract(
      "https://example.com/stream",
      2,
      1,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("15 MB cap");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
