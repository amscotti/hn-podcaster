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
  podcastAgent,
  scriptSuggestionsSchema,
  suggestionAgent,
  summaryAgent,
} from "../agents/index.ts";
import { config } from "../../lib/config.ts";
import { getAppLogger } from "../../lib/logger.ts";
import {
  createVoiceProvider,
  getSpeechTagGuidance,
} from "../../lib/providers.ts";

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
    // Failed downloads are already dropped in download-content; this is a
    // safety net so empty bodies never produce placeholder summaries.
    const stories = inputData.storiesWithText.filter(
      (s) => s.text.trim().length > 0,
    );
    if (stories.length < inputData.storiesWithText.length) {
      logger
        .warn`Filtered ${
        inputData.storiesWithText.length - stories.length
      } empty-content stories before summarization`;
    }

    logger.info`Generating summaries for ${stories.length} stories`;

    const summaries = await Promise.all(
      stories.map(async (story, index) => {
        const communityContext = story.commentsText
          ? `\n\n## Hacker News Community Discussion\nTop comments from the Hacker News thread. These show how real practitioners and readers are reacting to this story - their opinions, pushback, personal experiences, counterarguments, and things they spotted that the article missed. Actively weave the most interesting community perspectives into your talking points: what did readers think? Did they agree or push back? Did someone share a relevant real-world experience or a sharp counterpoint? Call out representative views and name that they come from the discussion, e.g. "readers pointed out...", "commenters were skeptical because...". Don't just summarize the comments in bulk - integrate the standout voices and opinions as part of the story.\n${story.commentsText}`
          : "";

        const prompt =
          `Create a detailed summary of this page, summarizing the main ideas and creating talking points that would be relevant for someone who hasn't read the article.
For each talking point, please include why it is relevant to the story and details about why you would tell someone this.
Where the community discussion adds useful perspectives, differing opinions, or vivid examples, make those prominent talking points too - listeners love hearing how people are actually reacting.

## Story
${story.text}${communityContext}`;

        logger.debug`Summarizing story ${index + 1}: ${story.title}`;
        const result = await summaryAgent.generate(prompt);
        return formatStoryContent(story, result.text);
      }),
    );

    logger.info`Generated ${summaries.length} summaries`;
    return {
      summaries,
      storiesWithText: stories,
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

    // Natural spoken date (e.g. "Friday, June 19th") - no time/timezone/year,
    // since reading a timestamp aloud sounds unnatural for a podcast intro.
    const spokenDate = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const ordinal = (n: number): string => {
      const s = ["th", "st", "nd", "rd"];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };
    const monthDay = spokenDate.replace(
      /(\d+)$/,
      (_, d) => ordinal(Number(d)),
    );
    const date = monthDay;

    const tagGuidance = getSpeechTagGuidance();

    // Target word count for the script. Podcast narration runs ~140 wpm once
    // delivery tags (pauses, etc.) are accounted for, so this maps the
    // configured duration to a concrete word budget the model can hit.
    const targetWords = config.targetDurationMinutes * 140;
    const perStoryWords = Math.round(targetWords / inputData.summaries.length);

    const prompt =
      `You're writing the script for "Hacker Insight," a tech podcast. Today is ${date}.

Your job is to turn these story summaries into a conversational, engaging monologue that sounds like a real person talking to curious listeners.

IMPORTANT: You must cover ALL ${inputData.summaries.length} stories provided below. Don't skip any.

LENGTH TARGET (very important): Aim for roughly ${targetWords} words total - about ${config.targetDurationMinutes} minutes spoken. With ${inputData.summaries.length} stories, that's around ${perStoryWords} words per story (plus intro/outro). Stay reasonably close to this target - do NOT write a terse summary, and do NOT pad with filler. If you're unsure, favor slightly more depth over brevity.

Guidelines:
- Open with a warm, friendly greeting ("Hey everyone, welcome to Hacker Insight...") and mention the date casually, the way a real host would ("It's Friday, June 19th" - never read a timestamp or year). Then a SHORT, high-level TEASE of what's coming - hint at the broad themes, common threads, or a couple of standout hooks to pull listeners in, like a movie trailer. Do NOT list every story or give a rundown - just build intrigue for what's ahead. Then dive into the first story.
- Cover EVERY story with similar depth. Each should get 2-3 substantial paragraphs of flowing content.
- When technical terms come up, explain them simply (e.g., "eBPF - that's a way to run tiny programs inside the Linux kernel to watch what's happening")
- Use conversational language - contractions, complete sentences (avoid choppy fragments), rhetorical questions.
- Where the summaries mention what Hacker News readers or commenters thought, weave those reactions in naturally - it adds a lot to occasionally reflect how practitioners are responding, where they agreed or pushed back, or a sharp comment someone made. Don't force it every story, but use the best ones.
- IMPORTANT: Bridge smoothly from one story to the next - never jump abruptly into a new topic. Each transition should connect the two stories with a brief link: a shared theme, a contrast, a question, or a one-line reaction to what came before. Vary them and make them feel like a real host connecting the dots (e.g., "Speaking of things that sound too good to be true...", "That's the optimistic view - now for the flip side.", "On a much lighter note..."). Avoid blunt cuts like a generic "Switching gears..." followed immediately by the new topic.
- IMPORTANT: End by stepping back to reflect on the episode as a whole - the range of topics explored, any common threads or patterns linking the stories, or a broader lesson or takeaway that ties them together. Think big picture, NOT a list of each story (the listener just heard them). Then a brief warm sign-off thanking listeners and inviting them back. Don't mention subscribing, comments, likes, or any platform-specific calls to action.
${tagGuidance}
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
    // Skip when iterations is 0, or if we already hit the configured cap
    // (covers do-while always running the step once before the condition).
    if (inputData.iterationCount >= config.improvementIterations) {
      logger
        .info`Skipping script improvement (IMPROVEMENT_ITERATIONS=${config.improvementIterations})`;
      return {
        script: inputData.script,
        summaries: inputData.summaries,
        iterationCount: inputData.iterationCount,
        shouldContinue: false,
      };
    }

    const iteration = inputData.iterationCount + 1;
    logger
      .info`Improving script (iteration ${iteration}/${config.improvementIterations})`;

    const storiesText = inputData.summaries.join("\n\n");

    // Word-count context so the editor can flag drift from the target length.
    const targetWords = config.targetDurationMinutes * 140;
    const currentWords = inputData.script.split(/\s+/).filter(Boolean).length;

    // Get structured suggestions
    const tagGuidance = getSpeechTagGuidance();
    const deliveryNote = tagGuidance
      ? "\nAlso judge the use of delivery tags (pauses, whispers, etc.) - suggest adding a tag where it would help, or removing overused ones.\n"
      : "";
    const suggestionPrompt = `Stories:
${storiesText}

Current Script:
${inputData.script}

LENGTH: The script is currently ${currentWords} words. Target is ~${targetWords} words (~${config.targetDurationMinutes} minutes spoken). Flag it under category "length" if it's more than ~15% off target.
${tagGuidance}${deliveryNote}`;

    logger.debug`Getting improvement suggestions`;
    const suggestionsResult = await suggestionAgent.generate(
      suggestionPrompt,
      { structuredOutput: { schema: scriptSuggestionsSchema } },
    );
    const suggestions = suggestionsResult.object;

    // Check if no improvements are needed
    if (
      !suggestions.improvementsNeeded || suggestions.suggestions.length === 0
    ) {
      logger.info`No improvements needed - script is ready`;
      return {
        script: inputData.script,
        summaries: inputData.summaries,
        iterationCount: iteration,
        shouldContinue: false,
      };
    }

    logger
      .info`Found ${suggestions.suggestions.length} suggestions to apply`;

    // Render structured suggestions as readable feedback for the improvement agent
    const suggestionsText = suggestions.suggestions
      .map((s, i) => {
        const quote = s.quote ? `\n  Quote: "${s.quote}"` : "";
        return `${i + 1}. [${s.category}]${quote}\n  Fix: ${s.fix}`;
      })
      .join("\n");

    // Apply improvements
    const improvementPrompt =
      `You're improving a podcast script based on editor feedback. Apply the suggestions while keeping the script natural and conversational.

LENGTH: Current script is ${currentWords} words; target is ~${targetWords} words (~${config.targetDurationMinutes} minutes). Keep the final length close to the target - expand with substance (not filler) if too short, trim repetition if too long.

Editor's suggestions:
${suggestionsText}

Original stories (for reference):
${storiesText}

Current script:
${inputData.script}

Apply the suggestions to improve the script. Keep it:
- Conversational and engaging - like a real person talking
- Well-paced - each story gets room to breathe
- Accessible - technical terms explained simply
- Flowing naturally between topics
${
        tagGuidance
          ? "- Preserve any delivery tags already in the script, and refine them per the guidance below.\n"
          : ""
      }${tagGuidance}
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

    // Initialize the configured voice provider (OpenAI or xAI/Grok)
    const { voice, speakOptions } = createVoiceProvider();
    logger.info`Using ${config.voiceProvider} voice provider for TTS`;

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
      const audioStream = await voice.speak(chunk, speakOptions);
      if (!audioStream) {
        throw new Error(
          `Voice provider returned no audio stream for chunk ${i + 1}`,
        );
      }

      // Collect audio data from the byte stream using async iteration
      const audioChunks: Uint8Array[] = [];
      for await (const data of audioStream) {
        // Handle both Buffer and Uint8Array from Node.js / web streams
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
const workflowInputSchema = z.object({
  storyCount: z.number().default(10),
});
const workflowOutputSchema = z.object({
  transcriptPath: z.string(),
  audioPath: z.string(),
  generatedAt: z.string(),
});

export const podcastWorkflow = createWorkflow({
  id: "podcast-generation",
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
  .then(fetchTopStoriesStep)
  .then(fetchStoriesMetadataStep)
  .then(downloadContentStep)
  .then(generateSummariesStep)
  .then(generateScriptStep)
  // Run improvement loop (exits early if no improvements needed)
  .dowhile(
    improveScriptOnceStep,
    // deno-lint-ignore require-await
    async ({ inputData }) =>
      inputData.shouldContinue &&
      inputData.iterationCount < config.improvementIterations,
  )
  .then(generateAudioStep)
  .commit();

export type PodcastWorkflowInput = z.infer<typeof workflowInputSchema>;
export type PodcastWorkflowOutput = z.infer<typeof workflowOutputSchema>;
