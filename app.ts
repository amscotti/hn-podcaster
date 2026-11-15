import { config } from "./src/lib/config.ts";
import { getAppLogger } from "./src/lib/logger.ts";
import { podcastWorkflow } from "./src/mastra/index.ts";

const logger = getAppLogger("app");

/** Human-readable labels for the workflow step ids emitted in stream events. */
export const STEP_LABELS: Record<string, string> = {
  "fetch-top-stories": "Fetching top stories",
  "fetch-stories-metadata": "Fetching story metadata",
  "download-content": "Downloading article content",
  "generate-summaries": "Generating summaries",
  "generate-script": "Writing podcast script",
  "improve-script-once": "Improving script",
  "direct-performance": "Directing voice performance",
  "generate-audio": "Generating audio",
};

/**
 * Log a single workflow stream event as a live progress line.
 * Streaming the run gives real-time visibility into each step as it happens,
 * rather than waiting silently for the whole pipeline to finish.
 */
export function logStreamEvent(event: {
  type?: string;
  id?: string;
  payload?: Record<string, unknown>;
}): void {
  const stepId = event.id ?? (event.payload?.id as string | undefined);
  const label = stepId && STEP_LABELS[stepId] ? STEP_LABELS[stepId] : stepId;

  switch (event.type) {
    case "workflow-start":
      logger.info`Workflow started`;
      break;
    case "workflow-step-start":
      if (label) logger.info`▶ ${label}...`;
      break;
    case "workflow-step-finish":
      if (label) logger.info`✓ ${label} done`;
      break;
    case "workflow-step-suspended":
      if (label) logger.info`⏸ ${label} suspended`;
      break;
    case "workflow-finish":
      logger.info`Workflow finished (${String(
        event.payload?.workflowStatus ?? "unknown",
      )})`;
      break;
    case "workflow-canceled":
      logger.warn`Workflow canceled`;
      break;
  }
}

/** Minimal workflow-result shape `main()` needs to report and exit. */
export interface WorkflowOutcome {
  status: string;
  result?: {
    transcriptPath: string;
    audioPath: string;
    generatedAt: string;
  };
}

/** True only for a success status carrying the workflow result. */
export function isSuccessfulOutcome(
  outcome: WorkflowOutcome,
): outcome is WorkflowOutcome & {
  result: NonNullable<WorkflowOutcome["result"]>;
} {
  return outcome.status === "success" && outcome.result !== undefined;
}

/** Map a workflow outcome to the process exit code. */
export function resolveExitCode(outcome: WorkflowOutcome): number {
  return isSuccessfulOutcome(outcome) ? 0 : 1;
}

/**
 * Run the podcast workflow and return the process exit code: 0 on success,
 * 1 on a non-success workflow result or thrown error. Returning the code
 * (instead of always exiting 0) keeps schedulers/CI honest on failure.
 *
 * `runWorkflow` is injectable so tests can exercise the exit-code and
 * output paths without running the real pipeline.
 */
export async function main(
  runWorkflow?: () => Promise<WorkflowOutcome>,
): Promise<number> {
  logger.info`Generating podcast...`;

  try {
    let result: WorkflowOutcome;
    if (runWorkflow) {
      result = await runWorkflow();
    } else {
      const run = await podcastWorkflow.createRun();

      // Stream the run for live progress, then await the final result.
      const runOutput = await run.stream({
        inputData: {
          storyCount: config.storyCount,
        },
      });

      for await (const event of runOutput.fullStream) {
        logStreamEvent(event);
      }

      result = (await runOutput.result) as WorkflowOutcome;
    }

    const exitCode = resolveExitCode(result);
    if (exitCode === 0 && isSuccessfulOutcome(result)) {
      console.log("\n✅ Podcast generation complete!");
      console.log(`📄 Transcript: ${result.result.transcriptPath}`);
      if (result.result.audioPath) {
        console.log(`🎙️  Audio: ${result.result.audioPath}`);
      }
    } else {
      console.error("\n❌ Podcast generation failed");
      console.error(result);
    }
    return exitCode;
  } catch (error) {
    logger.error`Error generating podcast: ${error}`;
    throw error;
  }
}

if (import.meta.main) {
  // The workflow's streaming machinery, AI provider HTTP clients, and LogTape
  // sinks keep the event loop alive after the work is done. This is a one-shot
  // CLI, so exit explicitly once main() resolves.
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
