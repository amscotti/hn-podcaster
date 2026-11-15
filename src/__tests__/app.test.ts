import { expect, test } from "bun:test";
import { main, resolveExitCode } from "../../app.ts";

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
  expect(resolveExitCode("success")).toBe(0);
  expect(resolveExitCode("failure")).toBe(1);
  expect(resolveExitCode("canceled")).toBe(1);
  expect(resolveExitCode("unknown")).toBe(1);
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
