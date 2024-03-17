import { OpenAI } from '@langchain/openai'
import { loadSummarizationChain, LLMChain } from 'langchain/chains'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { PromptTemplate } from '@langchain/core/prompts'
import { CheerioWebBaseLoader } from 'langchain/document_loaders/web/cheerio'
import { HtmlToTextTransformer } from '@langchain/community/document_transformers/html_to_text'

const SUMMARIES_COMBINATION_PROMPT = new PromptTemplate({
  inputVariables: ['text'],
  template: `You are tasked with summarizing the following text. Your goal is to capture all the key points and important information in your summary.

  Take into account the length of the original text. If the text is lengthy, your summary should also be longer to ensure it captures most, if not all, of the details.

  However, even if the original text is short, your summary should still be a minimum of one paragraph in length.

  Your output should strictly contain the summarized text. Exclude any additional elements or formats - focus solely on comprehensive rendition of the original content.

  "{text}"

  SUMMARY:`
})

const GENERATE_PODCAST_PROMPT = new PromptTemplate({
  inputVariables: ['text'],
  template: `I need you to follow this specific task. Keeping in mind a 15-minute duration, construct a podcast script from a list of summaries from HackerNews called "Hacker Insight".

  Here is how the podcast should be structured:

  1. Start with an introduction detailing the topics of the day which are to be discussed.
  2. Then delve into a detailed discussion on each topic utilizing the provided summaries along with the title of the article for context.
  3. Endeavor to create smooth transitions between the topics as you progress through the podcast.
  4. The podcast should conclude with an outro giving a quick recap of the covered topics and an inviting reminder for the audience to join in for the next podcast tomorrow.

  Please, remember that I only need the text representation (what the listeners would hear) of the podcast. Thus, exclude any stage directions, categorizations, audio cues, or labels such as '[Intro]', '[Topic]', '[Transition]'. Focus purely on the spoken content of the podcast.

  "{text}"

  PODCAST:`
})

export default class PodcastCreator {
  constructor () {
    const gpt35Turbo = new OpenAI({
      modelName: 'gpt-3.5-turbo',
      temperature: 0.7
    })

    const gpt4 = new OpenAI({
      modelName: 'gpt-4-turbo-preview',
      temperature: 1
    })

    // Used for creating summaries
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 5000,
      chunkOverlap: 1000
    })
    const htmlToText = new HtmlToTextTransformer()
    this.sequence = htmlToText.pipe(splitter)

    this.summarizer = loadSummarizationChain(gpt35Turbo, {
      type: 'map_reduce',
      combinePrompt: SUMMARIES_COMBINATION_PROMPT
    })

    // Used for creating the podcast
    this.podcastGenerator = new LLMChain({
      llm: gpt4,
      prompt: GENERATE_PODCAST_PROMPT
    })
  }

  async getWebPageText (url) {
    const loader = new CheerioWebBaseLoader(url)
    try {
      return await loader.load()
    } catch (error) {
      return ''
    }
  }

  async generateSummary (text) {
    const docs = await this.sequence.invoke(text)
    const res = await this.summarizer.call({ input_documents: docs })

    return res.text
  }

  async generatePodcast (summaries) {
    const res = await this.podcastGenerator.call({
      text: summaries.join('\n')
    })

    return res.text
  }
}
