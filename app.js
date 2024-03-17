import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { oraPromise } from 'ora'

import PodcastCreator from './src/PodcastCreator.js'
import PodcastRecorder from './src/PodcastRecorder.js'
import HackerNews from './src/HackerNews.js'

import { fileURLToPath } from 'url'

if (!process.env.OPENAI_API_KEY) {
  console.error(
    'OPENAI_API_KEY is not set. Please set the environment variable.'
  )
  process.exit(1)
}

const creator = new PodcastCreator()
const recorder = new PodcastRecorder()

const topStoryIds = await oraPromise(
  HackerNews.fetchTopStories(),
  'Getting top stories from HackerNews'
)

const summaries = []
for (const id of topStoryIds) {
  const story = await HackerNews.fetchStory(id)
  const text = await creator.getWebPageText(story.url)

  if (text !== '') {
    const summary = await oraPromise(
      creator.generateSummary(text),
      `Summarizing '${story.title}'`
    )
    summaries.push(`Title: ${story.title}\n\nSummary: ${summary}`)
  }
}

const podcast = await oraPromise(
  creator.generatePodcast(summaries),
  'Generating podcast from summaries'
)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outputFolder = path.join(__dirname, 'output')

const localDate = new Date()
localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset())
const dateStr = localDate.toISOString().slice(0, 10)
const outputFilename = `${dateStr}_podcast.mp3`

const transcriptionFilename = `${dateStr}_transcription.txt`
const transcriptionFilePath = path.join(outputFolder, transcriptionFilename)

await oraPromise(
  fs.promises.writeFile(transcriptionFilePath, podcast),
  'Writing transcript to disk'
)

await oraPromise(
  recorder.createRecording(podcast, path.join(outputFolder, outputFilename)),
  'Creating recording'
)
