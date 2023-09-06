import 'dotenv/config'
import { oraPromise } from 'ora'

import PodcastCreator from './src/PodcastCreator.js'
import HackerNews from './src/HackerNews.js'

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set. Please set the environment variable.')
  process.exit(1)
}

const creator = new PodcastCreator()

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
