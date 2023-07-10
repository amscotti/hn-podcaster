import { Configuration, OpenAIApi } from 'openai'

const SUMMARY = {
  model: 'gpt-3.5-turbo-16k',
  prompt: `As an AI assistant, you are tasked with summarizing the following text. Your goal is to capture all the key points and important information in your summary.

  Take into account the length of the original text. If the text is lengthy, your summary should also be longer to ensure it captures most, if not all, of the details.
  
  However, even if the original text is short, your summary should still be a minimum of one paragraph in length.
  
  Your output should strictly contain the summarized text. Exclude any additional elements or formats - focus solely on delivering a brief, comprehensive rendition of the original content.`
}

const GENERATE_PODCAST = {
  model: 'gpt-4',
  prompt: `As an assistant, I need you to follow this specific task. Keeping in mind a 15-minute duration, construct a podcast script from a list of summaries from HackerNews. 

  Here is how the podcast should be structured:
  
  1. Start with an introduction detailing the topics of the day which are to be discussed.
  2. Then delve into a detailed discussion on each topic utilizing the provided summaries along with the title of the article for context.
  3. Endeavor to create smooth transitions between the topics as you progress through the podcast. 
  4. The podcast should conclude with an outro giving a quick recap of the covered topics and an inviting reminder for the audience to join in for the next podcast tomorrow. 
  
  Please, remember that I only need the text representation (what the listeners would hear) of the podcast. Thus, exclude any stage directions, categorizations, audio cues, or labels such as '[Intro]', '[Topic]', '[Transition]'. Focus purely on the spoken content of the podcast.`
}

export default class OpenAI {
  constructor (config) {
    this.openai = new OpenAIApi(new Configuration(config))
  }

  async generateSummary (text) {
    const gptResponse = await this.openai.createChatCompletion({
      model: SUMMARY.model,
      messages: [
        { role: 'system', content: SUMMARY.prompt },
        { role: 'user', content: text }
      ]
    })

    return gptResponse.data.choices[0].message.content
  }

  async generatePodcast (summaries) {
    const gptResponse = await this.openai.createChatCompletion({
      model: GENERATE_PODCAST.model,
      messages: [
        { role: 'system', content: GENERATE_PODCAST.prompt },
        { role: 'user', content: summaries.join('\n') }
      ]
    })

    return gptResponse.data.choices[0].message.content
  }
}
