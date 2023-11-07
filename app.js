import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { oraPromise } from 'ora'

import PodcastCreator from './src/PodcastCreator.js'
import PodcastRecorder from './src/PodcastRecorder.js'
import HackerNews from './src/HackerNews.js'

import { fileURLToPath } from 'url'

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set. Please set the environment variable.')
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

console.log(`\n\n${podcast}\n`)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outputFolder = path.join(__dirname, 'output')
// Adjust the date to the local timezone before formatting
const localDate = new Date()
localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset())
const dateStr = localDate.toISOString().slice(0, 10) // Format: YYYY-MM-DD
const outputFilename = `${dateStr}_podcast.mp3`
// Save the podcast text to a transcription file
const transcriptionFilename = `${dateStr}_transcription.txt`
const transcriptionFilePath = path.join(outputFolder, transcriptionFilename)
await fs.promises.writeFile(transcriptionFilePath, podcast)

recorder.createRecording(podcast, path.join(outputFolder, outputFilename))
