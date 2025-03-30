import fs from "node:fs";
import path from "node:path";
import { oraPromise } from "ora";

import { fetchStory, fetchTopStories } from "./src/HackerNews.js";
import PodcastCreator from "./src/PodcastCreator.js";
import PodcastRecorder from "./src/PodcastRecorder.js";

import { fileURLToPath } from "node:url";

const STORY = "story";
const COUNT = 15;

function formatDate(unixTimestamp) {
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

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is not set. Please set the environment variable.");
  process.exit(1);
}

const creator = new PodcastCreator();
const recorder = new PodcastRecorder();

const topStoryIds = await oraPromise(fetchTopStories(), "Getting top stories from HackerNews");

const storiesMetaData = await oraPromise(
  Promise.all(topStoryIds.map(async (id) => await fetchStory(id))),
  "Downloading stories meta data"
);

const storiesText = await oraPromise(
  Promise.all(
    storiesMetaData
      .filter((s) => s.type === STORY && s.url !== undefined)
      .slice(0, COUNT)
      .map(async (story) => {
        const text = await creator.getWebPageText(story.url);
        return { ...story, text };
      })
  ),
  "Downloading stories text"
);

const stories = await oraPromise(
  Promise.all(
    storiesText.map(async (story) => {
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
    })
  ),
  "Reading stories"
);

const script = await oraPromise(
  creator.generatePodcast(stories),
  "Generating podcast from stories"
);

const podcast = await oraPromise(creator.improvementLoop(stories, script), "Improving script");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputFolder = path.join(__dirname, "output");

const localDate = new Date();
localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
const dateStr = localDate.toISOString().slice(0, 10);
const outputFilename = `${dateStr}_podcast.mp3`;

const transcriptionFilename = `${dateStr}_transcription.txt`;
const transcriptionFilePath = path.join(outputFolder, transcriptionFilename);

await oraPromise(
  fs.promises.writeFile(transcriptionFilePath, podcast),
  "Writing transcript to disk"
);

await oraPromise(
  recorder.createRecording(podcast, path.join(outputFolder, outputFilename)),
  "Creating recording"
);
