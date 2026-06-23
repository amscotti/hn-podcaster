import { config } from "./src/lib/config.ts";
import { getAppLogger } from "./src/lib/logger.ts";
import { podcastWorkflow } from "./src/mastra/index.ts";

const logger = getAppLogger("app");

/** Human-readable labels for the workflow step ids emitted in stream events. */
const STEP_LABELS: Record<string, string> = {
  "fetch-top-stories": "Fetching top stories",
  "fetch-stories-metadata": "Fetching story metadata",
  "download-content": "Downloading article content",
  "generate-summaries": "Generating summaries",
  "generate-script": "Writing podcast script",
  "improve-script-once": "Improving script",
  "generate-audio": "Generating audio",
};

/**
 * Log a single workflow stream event as a live progress line.
 * Streaming the run gives real-time visibility into each step as it happens,
 * rather than waiting silently for the whole pipeline to finish.
 */
function logStreamEvent(
  event: { type?: string; id?: string; payload?: Record<string, unknown> },
): void {
  const stepId = event.id ?? (event.payload?.id as string | undefined);
  const label = (stepId && STEP_LABELS[stepId]) ? STEP_LABELS[stepId] : stepId;

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
      logger.info`Workflow finished (${
        String(event.payload?.workflowStatus ?? "unknown")
      })`;
      break;
    case "workflow-canceled":
      logger.warn`Workflow canceled`;
      break;
  }
}

async function main(): Promise<void> {
  logger.info`Generating podcast...`;

  try {
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

    const result = await runOutput.result;

    if (result.status === "success") {
      console.log("\n✅ Podcast generation complete!");
      console.log(`📄 Transcript: ${result.result.transcriptPath}`);
      console.log(`🎙️  Audio: ${result.result.audioPath}`);
    } else {
      console.error("\n❌ Podcast generation failed");
      console.error(result);
    }
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
    .then(() => Deno.exit(0))
    .catch((error) => {
      console.error(error);
      Deno.exit(1);
    });
}
