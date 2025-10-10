import { fetchStory, fetchTopStories, type Story } from "../HackerNews.ts";
import {
  PodcastCreatorService,
  TextToSpeechService,
} from "../services/interfaces.ts";
import {
  ApiError,
  PodcastGenerationError,
  ValidationError,
} from "../shared/errors.ts";
import { logger } from "../shared/logger.ts";

export interface PodcastGenerationOptions {
  storyCount?: number;
  outputDir?: string;
}

export interface PodcastGenerationResult {
  transcriptPath: string;
  audioPath: string;
  storyCount: number;
  generatedAt: Date;
  duration: number; // in milliseconds
}

export class PodcastGenerationWorkflow {
  constructor(
    private creator: PodcastCreatorService,
    private recorder: TextToSpeechService,
  ) {}

  async execute(
    options: PodcastGenerationOptions = {},
  ): Promise<PodcastGenerationResult> {
    const startTime = Date.now();
    const { storyCount = 10, outputDir = "./output" } = options;

    logger.info(`Starting podcast generation with ${storyCount} stories`);

    try {
      // Step 1: Fetch stories
      const storyIds = await this.fetchTopStories();
      const stories = await this.fetchAndProcessStories(storyIds, storyCount);

      if (stories.length === 0) {
        throw new ValidationError("No valid stories found to process");
      }

      logger.info(`Processing ${stories.length} stories`);

      // Step 2: Generate content
      const summaries = await this.generateSummaries(stories);
      const script = await this.generatePodcastScript(summaries);
      const finalScript = await this.improveScript(stories, script, summaries);

      // Step 3: Generate outputs
      const result = await this.generateOutputs(
        finalScript,
        outputDir,
        stories,
      );
      const duration = Date.now() - startTime;

      logger.info(`✅ Podcast generation completed in ${duration}ms`);
      logger.info(`Transcript: ${result.transcriptPath}`);
      logger.info(`Audio: ${result.audioPath}`);

      return { ...result, duration };
    } catch (error) {
      logger.error("Podcast generation failed", { error });
      if (error instanceof PodcastGenerationError) {
        throw error;
      }
      throw new PodcastGenerationError(
        `Podcast generation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error,
      );
    }
  }

  protected async fetchTopStories(): Promise<number[]> {
    try {
      logger.info("Getting top stories from HackerNews");
      const storyIds = await fetchTopStories();
      logger.debug(`Fetched ${storyIds.length} story IDs`);
      return storyIds;
    } catch (error) {
      throw new ApiError(
        "Failed to fetch top stories from HackerNews",
        undefined,
        error,
      );
    }
  }

  protected async fetchAndProcessStories(
    storyIds: number[],
    count: number,
  ): Promise<Story[]> {
    try {
      logger.info("Downloading stories meta data");
      const allStories = await Promise.all(
        storyIds.slice(0, count).map((id) => fetchStory(id)),
      );

      const validStories = allStories.filter((story) =>
        story.type === "story" && story.url
      );

      logger.debug(
        `Fetched ${allStories.length} stories, ${validStories.length} are valid with URLs`,
      );

      if (validStories.length < count * 0.5) {
        logger.warn(
          `Only ${validStories.length} out of ${count} requested stories are valid`,
        );
      }

      return validStories;
    } catch (error) {
      throw new ApiError("Failed to fetch story details", undefined, error);
    }
  }

  private async generateSummaries(stories: Story[]): Promise<string[]> {
    try {
      logger.info("Downloading stories text");
      const storiesWithText = await Promise.all(
        stories.map(async (story) => {
          try {
            const text = await this.creator.getWebPageText(story.url!);
            return { ...story, text };
          } catch (error) {
            logger.warn(
              `Failed to fetch content for "${story.title}": ${error}`,
            );
            // Return story with empty text so processing can continue
            return { ...story, text: "" };
          }
        }),
      );

      logger.info("Reading stories");
      const summaries = await Promise.all(
        storiesWithText.map(async (story) => {
          if (!story.text) {
            return this.formatStoryContent(
              story,
              "Content could not be fetched",
            );
          }
          const summary = await this.creator.getSummary(story.text);
          return this.formatStoryContent(story, summary);
        }),
      );

      return summaries;
    } catch (error) {
      throw new PodcastGenerationError(
        "Failed to generate story summaries",
        error,
      );
    }
  }

  private async generatePodcastScript(summaries: string[]): Promise<string> {
    try {
      logger.info("Generating podcast from stories");
      const script = await this.creator.generatePodcast(summaries);
      return script;
    } catch (error) {
      throw new PodcastGenerationError(
        "Failed to generate podcast script",
        error,
      );
    }
  }

  private async improveScript(
    _stories: Story[],
    script: string,
    summaries: string[],
  ): Promise<string> {
    try {
      logger.info("Improving script");
      const improvedScript = await this.creator.improvementLoop(
        _stories,
        summaries,
        script,
      );
      return improvedScript;
    } catch (error) {
      throw new PodcastGenerationError(
        "Failed to improve podcast script",
        error,
      );
    }
  }

  private async generateOutputs(
    script: string,
    outputDir: string,
    stories: Story[],
  ): Promise<Omit<PodcastGenerationResult, "duration">> {
    try {
      // Ensure output directory exists
      try {
        await Deno.mkdir(outputDir, { recursive: true });
      } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) {
          throw new PodcastGenerationError(
            `Failed to create output directory: ${outputDir}`,
            error,
          );
        }
      }

      const timestamp = new Date().toISOString().slice(0, 10);
      const transcriptPath = `${outputDir}/${timestamp}_podcast.txt`;
      const audioPath = `${outputDir}/${timestamp}_podcast.mp3`;

      logger.info("Writing transcript to disk");
      await Deno.writeTextFile(transcriptPath, script);

      logger.info("Creating recording");
      await this.recorder.createAudio(script, audioPath);

      return {
        transcriptPath,
        audioPath,
        storyCount: stories.length,
        generatedAt: new Date(),
      };
    } catch (error) {
      throw new PodcastGenerationError(
        "Failed to generate output files",
        error,
      );
    }
  }

  private formatStoryContent(
    story: Story & { text: string },
    summary: string,
  ): string {
    const formatDate = (unixTimestamp: number): string => {
      const date = new Date(unixTimestamp * 1000);
      return date.toLocaleString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      });
    };

    return `
## ${story.title}
Posted Date: ${formatDate(story.time)}
URL: ${story.url}

### Story Text
${story.text}

### Summary and Talking Points
${summary}
    `.trim();
  }
}
