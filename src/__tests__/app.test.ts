import { expect, test } from "bun:test";
import { isSuccessfulOutcome, main, resolveExitCode } from "../../app.ts";

function captureConsole(): {
  logs: string[];
  errors: string[];
  restore(): void;
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  return {
    logs,
    errors,
    restore() {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

test("resolveExitCode - success 0, non-success 1", () => {
  const ok = {
    status: "success",
    result: {
      transcriptPath: "/tmp/t.txt",
      audioPath: "/tmp/a.mp3",
      generatedAt: "now",
    },
  };
  expect(resolveExitCode(ok)).toBe(0);
  expect(resolveExitCode({ status: "failure" })).toBe(1);
  expect(resolveExitCode({ status: "canceled" })).toBe(1);
  expect(resolveExitCode({ status: "unknown" })).toBe(1);
  expect(isSuccessfulOutcome(ok)).toBe(true);
  expect(isSuccessfulOutcome({ status: "failure" })).toBe(false);
});

test("main - success returns 0 and prints transcript + audio", async () => {
  const cap = captureConsole();
  try {
    const code = await main(async () => ({
      status: "success",
      result: {
        transcriptPath: "/tmp/episode.txt",
        audioPath: "/tmp/episode.mp3",
        generatedAt: "2026-11-15T00:00:00Z",
      },
    }));
    expect(code).toBe(0);
    expect(cap.logs.join("\n")).toContain("Transcript: /tmp/episode.txt");
    expect(cap.logs.join("\n")).toContain("Audio: /tmp/episode.mp3");
  } finally {
    cap.restore();
  }
});

test("main - success with empty audioPath omits Audio line", async () => {
  const cap = captureConsole();
  try {
    const code = await main(async () => ({
      status: "success",
      result: {
        transcriptPath: "/tmp/episode.txt",
        audioPath: "",
        generatedAt: "2026-11-15T00:00:00Z",
      },
    }));
    expect(code).toBe(0);
    expect(cap.logs.join("\n")).toContain("Transcript: /tmp/episode.txt");
    expect(cap.logs.some((line) => line.includes("Audio:"))).toBe(false);
  } finally {
    cap.restore();
  }
});

test("main - non-success returns 1 and reports failure", async () => {
  const cap = captureConsole();
  try {
    const code = await main(async () => ({ status: "failure" }));
    expect(code).toBe(1);
    expect(cap.errors.join("\n")).toContain("Podcast generation failed");
  } finally {
    cap.restore();
  }
});

test("main - success status without result exits 1 and reports failure", async () => {
  expect(resolveExitCode({ status: "success" })).toBe(1);
  expect(isSuccessfulOutcome({ status: "success" })).toBe(false);
  const cap = captureConsole();
  try {
    const code = await main(async () => ({ status: "success" }));
    expect(code).toBe(1);
    expect(cap.logs.join("\n")).not.toContain("Podcast generation complete");
    expect(cap.errors.join("\n")).toContain("Podcast generation failed");
  } finally {
    cap.restore();
  }
});

test("main - thrown error is caught and returns 1", async () => {
  const cap = captureConsole();
  try {
    const code = await main(async () => {
      throw new Error("workflow exploded");
    });
    expect(code).toBe(1);
    expect(cap.logs.join("\n")).not.toContain("Podcast generation complete");
  } finally {
    cap.restore();
  }
});
