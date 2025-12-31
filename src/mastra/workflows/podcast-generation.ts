import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "@zod/zod";
import {
  downloadContentStep,
  fetchStoriesMetadataStep,
  fetchTopStoriesStep,
  formatStoryContent,
  StoryWithTextSchema,
} from "../steps/index.ts";
import {
  improvementAgent,
  NO_IMPROVEMENTS_MARKER,
  podcastAgent,
  suggestionAgent,
  summaryAgent,
} from "../agents/index.ts";
import { config } from "../../lib/config.ts";
import { getAppLogger } from "../../lib/logger.ts";
import { getVoiceConfig } from "../../lib/providers.ts";
import { OpenAIVoice } from "@mastra/voice-openai";
import type { OpenAIConfig } from "@mastra/voice-openai";

// Extract OpenAIModel type from OpenAIConfig (not exported by library)
type OpenAIModel = NonNullable<OpenAIConfig["name"]>;

const logger = getAppLogger("workflow");

/**
 * Step 4: Generate summaries for each story using AI
 */
const generateSummariesStep = createStep({
  id: "generate-summaries",
  inputSchema: z.object({
    storiesWithText: z.array(StoryWithTextSchema),
  }),
  outputSchema: z.object({
    summaries: z.array(z.string()),
    storiesWithText: z.array(StoryWithTextSchema),
  }),
  execute: async ({ inputData }) => {
    logger
      .info`Generating summaries for ${inputData.storiesWithText.length} stories`;

    const summaries = await Promise.all(
      inputData.storiesWithText.map(async (story, index) => {
        if (!story.text) {
          logger.warn`Story ${
            index + 1
          } has no content, skipping summarization`;
          return formatStoryContent(story, "Content could not be fetched");
        }

        const prompt =
          `Create a detailed summary of this page, summarizing the main ideas and creating talking points that would be relevant for someone who hasn't read the article.
For each talking point, please include why it is relevant to the story and details about why you would tell someone this.

## Story
${story.text}`;

        logger.debug`Summarizing story ${index + 1}: ${story.title}`;
        const result = await summaryAgent.generate(prompt);
        return formatStoryContent(story, result.text);
      }),
    );

    logger.info`Generated ${summaries.length} summaries`;
    return {
      summaries,
      storiesWithText: inputData.storiesWithText,
    };
  },
});

/**
 * Step 5: Generate initial podcast script
 */
const generateScriptStep = createStep({
  id: "generate-script",
  inputSchema: z.object({
    summaries: z.array(z.string()),
    storiesWithText: z.array(StoryWithTextSchema),
  }),
  outputSchema: z.object({
    script: z.string(),
    summaries: z.array(z.string()),
    iterationCount: z.number(),
  }),
  execute: async ({ inputData }) => {
    logger.info`Generating initial podcast script`;

    const date = new Date().toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });

    const prompt =
      `You're writing the script for "Hacker Insight," a tech podcast. Today is ${date}.

Your job is to turn these story summaries into a conversational, engaging monologue that sounds like a real person talking to curious listeners.

IMPORTANT: You must cover ALL ${inputData.summaries.length} stories provided below. Don't skip any.

Guidelines:
- Open with a warm, friendly greeting ("Hey everyone, welcome to Hacker Insight...") and mention the date naturally. Include a brief, enticing preview of 3-4 highlights to hook listeners (e.g., "Today we've got climate breakthroughs, rocket wisdom, and a hundred-year-old bear"). Then dive into the first story.
- Cover EVERY story with similar depth. Each should get 2-3 substantial paragraphs of flowing content.
- When technical terms come up, explain them simply (e.g., "eBPF - that's a way to run tiny programs inside the Linux kernel to watch what's happening")
- Use conversational language - contractions, complete sentences (avoid choppy fragments), rhetorical questions.
- Transitions should be simple and natural: "Now for something different...", "Here's a fun one...", "Switching gears..."
- IMPORTANT: End with a warm sign-off that thanks listeners and invites them back. Keep it simple like "That's all for today. Thanks for listening, and I'll catch you next time on Hacker Insight." Don't mention subscribing, comments, likes, or any platform-specific calls to action.

What to avoid:
- Skipping or combining stories - every story gets its own section
- Dense sentences packing too many facts into one breath
- Unexplained jargon or acronyms
- Reading code, SQL, or technical syntax aloud - describe what it does instead

Here are all ${inputData.summaries.length} stories to cover:

${inputData.summaries.join("\n\n")}

Write the complete script covering ALL stories as flowing paragraphs.`;

    const result = await podcastAgent.generate(prompt);

    logger.info`Initial script generated (${result.text.length} characters)`;
    return {
      script: result.text,
      summaries: inputData.summaries,
      iterationCount: 0,
    };
  },
});

/**
 * Step 6: Improve script (single iteration)
 */
const improveScriptOnceStep = createStep({
  id: "improve-script-once",
  inputSchema: z.object({
    script: z.string(),
    summaries: z.array(z.string()),
    iterationCount: z.number(),
    shouldContinue: z.boolean().default(true),
  }),
  outputSchema: z.object({
    script: z.string(),
    summaries: z.array(z.string()),
    iterationCount: z.number(),
    shouldContinue: z.boolean(),
  }),
  execute: async ({ inputData }) => {
    const iteration = inputData.iterationCount + 1;
    logger
      .info`Improving script (iteration ${iteration}/${config.improvementIterations})`;

    const storiesText = inputData.summaries.join("\n\n");

    // Get suggestions
    const suggestionPrompt = `Stories:
${storiesText}

Current Script:
${inputData.script}`;

    logger.debug`Getting improvement suggestions`;
    const suggestionsResult = await suggestionAgent.generate(suggestionPrompt);

    // Check if no improvements are needed
    if (suggestionsResult.text.trim() === NO_IMPROVEMENTS_MARKER) {
      logger.info`No improvements needed - script is ready`;
      return {
        script: inputData.script,
        summaries: inputData.summaries,
        iterationCount: iteration,
        shouldContinue: false,
      };
    }

    // Apply improvements
    const improvementPrompt =
      `You're improving a podcast script based on editor feedback. Apply the suggestions while keeping the script natural and conversational.

Editor's suggestions:
${suggestionsResult.text}

Original stories (for reference):
${storiesText}

Current script:
${inputData.script}

Apply the suggestions to improve the script. Keep it:
- Conversational and engaging - like a real person talking
- Well-paced - each story gets room to breathe
- Accessible - technical terms explained simply
- Flowing naturally between topics

Output the improved script as plain paragraphs only. No formatting, lists, or stage directions.`;

    logger.debug`Applying improvements`;
    const improvedResult = await improvementAgent.generate(improvementPrompt);

    logger.info`Script improved (iteration ${iteration} complete)`;
    return {
      script: improvedResult.text,
      summaries: inputData.summaries,
      iterationCount: iteration,
      shouldContinue: true,
    };
  },
});

/**
 * Step 7: Generate audio from script using TTS
 */
const generateAudioStep = createStep({
  id: "generate-audio",
  inputSchema: z.object({
    script: z.string(),
    summaries: z.array(z.string()),
    iterationCount: z.number(),
  }),
  outputSchema: z.object({
    transcriptPath: z.string(),
    audioPath: z.string(),
    generatedAt: z.string(),
  }),
  execute: async ({ inputData }) => {
    logger.info`Generating audio from script`;

    const outputDir = config.outputDir;

    // Ensure output directory exists
    try {
      await Deno.mkdir(outputDir, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw error;
      }
    }

    // Generate timestamp with date and time for unique filenames (YYYY-MM-DD_HH-MM-SS)
    const timestamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace("T", "_")
      .replaceAll(":", "-");
    const transcriptPath = `${outputDir}/${timestamp}_podcast.txt`;
    const audioPath = `${outputDir}/${timestamp}_podcast.mp3`;

    // Write transcript
    await Deno.writeTextFile(transcriptPath, inputData.script);
    logger.info`Transcript saved to ${transcriptPath}`;

    // Skip audio generation if configured
    if (config.skipAudio) {
      logger.info`Skipping audio generation (SKIP_AUDIO=true)`;
      return {
        transcriptPath,
        audioPath: "",
        generatedAt: new Date().toISOString(),
      };
    }

    // Initialize Mastra OpenAI Voice
    // Note: Mastra types are restrictive but gpt-4o-mini-tts works at runtime
    const voiceConfig = getVoiceConfig();
    const voice = new OpenAIVoice({
      speechModel: {
        name: voiceConfig.model as OpenAIModel,
        apiKey: voiceConfig.apiKey,
      },
      speaker: voiceConfig.speaker,
    });

    // Split text into chunks and generate audio
    const textChunks = inputData.script
      .split(/\n\s*\n/)
      .map((chunk: string) => chunk.trim())
      .filter((chunk: string) => chunk.length > 0);

    logger.info`Generating audio for ${textChunks.length} text chunks`;

    const partFiles: string[] = [];

    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      const partFilePath = audioPath.replace(/(\.mp3)$/, `-${i}$1`);

      logger.debug`Generating audio chunk ${i + 1}/${textChunks.length}`;
      const audioStream = await voice.speak(chunk, {
        instructions: voiceConfig.instructions,
      });

      // Collect audio data from Node.js ReadableStream using async iteration
      const audioChunks: Uint8Array[] = [];
      for await (const data of audioStream) {
        // Handle both Buffer and Uint8Array from Node.js streams
        if (data instanceof Uint8Array) {
          audioChunks.push(data);
        } else if (typeof data === "object" && data !== null) {
          audioChunks.push(new Uint8Array(data as ArrayBuffer));
        }
      }
      const totalLength = audioChunks.reduce((acc, arr) => acc + arr.length, 0);
      const buffer = new Uint8Array(totalLength);
      let offset = 0;
      for (const arr of audioChunks) {
        buffer.set(arr, offset);
        offset += arr.length;
      }

      await Deno.writeFile(partFilePath, buffer);
      partFiles.push(partFilePath);
    }

    // Concatenate all chunks
    logger.info`Concatenating ${partFiles.length} audio chunks`;
    const outputFile = await Deno.open(audioPath, {
      write: true,
      create: true,
    });
    try {
      for (const partFile of partFiles) {
        const data = await Deno.readFile(partFile);
        await outputFile.write(data);
      }
    } finally {
      outputFile.close();
    }

    // Clean up chunk files
    for (const partFile of partFiles) {
      try {
        await Deno.remove(partFile);
      } catch (_err) {
        // Ignore cleanup errors
      }
    }

    logger.info`Audio saved to ${audioPath}`;
    return {
      transcriptPath,
      audioPath,
      generatedAt: new Date().toISOString(),
    };
  },
});

/**
 * Main podcast generation workflow
 */
export const podcastWorkflow = createWorkflow({
  id: "podcast-generation",
  inputSchema: z.object({
    storyCount: z.number().default(10),
  }),
  outputSchema: z.object({
    transcriptPath: z.string(),
    audioPath: z.string(),
    generatedAt: z.string(),
  }),
})
  .then(fetchTopStoriesStep)
  .then(fetchStoriesMetadataStep)
  .then(downloadContentStep)
  .then(generateSummariesStep)
  .then(generateScriptStep)
  // Run improvement loop (exits early if no improvements needed)
  .dowhile(
    improveScriptOnceStep,
    ({ inputData }) =>
      Promise.resolve(
        inputData.shouldContinue &&
          inputData.iterationCount < config.improvementIterations,
      ),
  )
  .then(generateAudioStep)
  .commit();

export type PodcastWorkflowInput = z.infer<typeof podcastWorkflow.inputSchema>;
export type PodcastWorkflowOutput = z.infer<
  typeof podcastWorkflow.outputSchema
>;
