import { config } from "./src/lib/config.ts";
import { getAppLogger } from "./src/lib/logger.ts";
import { podcastWorkflow } from "./src/mastra/index.ts";

const logger = getAppLogger("app");

async function main(): Promise<void> {
  logger.info`Generating podcast...`;

  try {
    const run = await podcastWorkflow.createRunAsync();
    const result = await run.start({
      inputData: {
        storyCount: config.storyCount,
      },
    });

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
  main().catch(console.error);
}
