import Kia from "@jonasschiano/kia";

import { fetchStory, fetchTopStories, type Story } from "./src/HackerNews.ts";
import PodcastCreator from "./src/PodcastCreator.ts";
import PodcastRecorder from "./src/PodcastRecorder.ts";
import {
  createLanguageModelService,
  createTextToSpeechService,
} from "./src/services/factory.ts";

const STORY = "story";
const COUNT = 10;

/**
 * Helper function to wrap promises with a Kia spinner and return the actual result
 */
async function withSpinner<T>(
  action: Promise<T>,
  options: { text: string },
): Promise<T> {
  const kia = new Kia(options).start();
  try {
    const result = await action;
    kia.succeed();
    return result;
  } catch (error) {
    kia.fail();
    throw error;
  }
}

function formatDate(unixTimestamp: number): string {
  const date = new Date(unixTimestamp * 1000);

  // Format the date in a readable way
  return date.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

async function main(): Promise<void> {
  const creator = new PodcastCreator(createLanguageModelService());
  const recorder = new PodcastRecorder(createTextToSpeechService());

  const topStoryIds = await withSpinner(
    fetchTopStories(),
    { text: "Getting top stories from HackerNews" },
  );

  const storiesMetaData = await withSpinner(
    Promise.all(topStoryIds.map(async (id: number) => await fetchStory(id))),
    { text: "Downloading stories meta data" },
  );

  const storiesText = await withSpinner(
    Promise.all(
      storiesMetaData
        .filter((s: Story) => s.type === STORY && s.url !== undefined)
        .slice(0, COUNT)
        .map(async (story: Story) => {
          const text = await creator.getWebPageText(story.url!);
          return { ...story, text };
        }),
    ),
    { text: "Downloading stories text" },
  );

  const stories = await withSpinner(
    Promise.all(
      storiesText.map(async (story: Story & { text: string }) => {
        const talkingPoints = await creator.getSummary(story.text);

        return `
      ## ${story.title}
      Posted Date: ${formatDate(story.time)}
      URL: ${story.url}

      ### Story Text
      ${story.text}

      ### Summary and Talking Points
      ${talkingPoints}
      `.trim();
      }),
    ),
    { text: "Reading stories" },
  );

  const script = await withSpinner(
    creator.generatePodcast(stories),
    { text: "Generating podcast from stories" },
  );

  const podcast = await withSpinner(
    creator.improvementLoop([], stories, script),
    { text: "Improving script" },
  );

  const __dirname = new URL(".", import.meta.url).pathname;
  const outputFolder = `${__dirname}output`;

  const localDate = new Date();
  localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
  const dateStr = localDate.toISOString().slice(0, 10);
  const outputFilename = `${dateStr}_podcast.mp3`;

  const transcriptionFilename = `${dateStr}_transcription.txt`;
  const transcriptionFilePath = `${outputFolder}/${transcriptionFilename}`;

  await withSpinner(
    Deno.writeTextFile(transcriptionFilePath, podcast),
    { text: "Writing transcript to disk" },
  );

  await withSpinner(
    recorder.createRecording(podcast, `${outputFolder}/${outputFilename}`),
    { text: "Creating recording" },
  );
}

/**
 * Main application entry point
 * Only runs when this module is executed directly (not imported)
 */
if (import.meta.main) {
  main().catch(console.error);
}
