import { convert } from "html-to-text";
import OpenAI from "openai";

const generateSummaryTalkingPointsPrompt = (text) => {
  return `Create a detailed summary of this page, summarizing the main ideas and creating talking points that would be relevant for someone who hasn't read the article.
For each talking point, please include why it is relevant to the story and details about why you would tell someone this.

## Story
${text}`.trim();
};

const generatePodcastPrompt = (date, text) => {
  return `Please follow this specific task. Keeping in mind a 10-minute duration, construct a podcast script from a list of stories from HackerNews called "Hacker Insight".

Here is how the podcast should be structured:

1. Start with an introduction detailing the topics of the day to be discussed.
2. Then, delve into a detailed discussion on each topic, utilizing the provided summaries along with the title of the article for context.
3. Create smooth transitions between the topics as you progress through the podcast.
4. The podcast should conclude with an outro that gives a quick recap of the covered topics and an inviting reminder for the audience to join in for the next podcast tomorrow.
5. You should be engaging and interested in the topics you are covering.
6. Don't treat this as just a summary; engage in the topic and ensure you cover the talking points for each story.

Please remember that I only need the text representation (what the listeners would hear) of the podcast. So, exclude any stage directions, categorizations, audio cues, or labels such as '[Intro]', '[Topic]', '[Transition]'. Focus purely on the spoken content of the podcast.

Today's date is: ${date}

# Stories

${text}

Please return just the text for the podcast without any additional dialogue.`.trim();
};

const generateSuggestionPrompt = (stories, podcastScript) => {
  return `You are an editor of a podcast script. You will review the following script and create a list of precise suggested updates to improve the content.

Focus on the following areas:
- Is each topic long enough to properly cover it and provide the listener with enough details, without going too in-depth?
- Is there duplication within the topic? Is something being repeated without adding or emphasizing details?
- Is each topic clearly covered, easy to understand, and presented in a well-structured way?
- Have all the suggested talking points been covered?
- Is the podcast engaging? Does the user want to listen until the end?
- Does the podcast sound natural?
- Are there proper transitions between the topics that feel natural?
- Is there a proper intro covering what the show will offer?
- Is there a proper outro summarizing the topics covered?

You should generate a list of suggestions that can be used to improve the transcript, but maintain the current structure.
Here are examples of suggestions to avoid, as they are too open-ended:
 - "Make transitions better"
 - "Reduce duplication"
 - "Outro isn't smooth"

Here are better examples that offer more precise recommendations for improvements:
 - "The transition between the first topic and the second topic doesn't feel smooth. I would suggest trying to link the two topics together because of how similar they are."
 - "The second topic has some duplicate information which doesn't really add to the overall understanding of the topic. Remove the second definition of what agile methodology is."
 - "The outro doesn't really cover and wrap together all the topics discussed. I would suggest reiterating some interesting points from the topics."

## Podcast Script
${podcastScript}

## Stories
${stories}

Only return your list of suggested items, no other comments are needed.
`.trim();
};

const generateImprovementPrompt = (suggestions, stories, podcastScript) => {
  return `You're working on improving a podcast script. Your editor has provided you with some suggested improvements that you will apply to the script.

You will edit the script with these rules in mind:
- You will leave the script in its current format.
- You will make the minimum amount of changes based on the suggestions.
- You can enhance any of the topics covered.
- You will not add any additional topics not already covered by the script.
- Your output will only be the script itself and nothing else. This includes no additional formatting or emojis, just the text.

## Suggestions
${suggestions}

## Podcast Script
${podcastScript}

## Stories
${stories}

Again, only submit the updated script text, with no remarks, comments, formatting, or emojis.
  `.trim();
};

export default class PodcastCreator {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async getWebPageText(url) {
    const response = await fetch(url);
    try {
      return convert(await response.text(), { wordwrap: 130 });
    } catch (_error) {
      return "";
    }
  }

  async getSummary(story) {
    const prompt = generateSummaryTalkingPointsPrompt(story);
    const res = await this.openai.chat.completions.create({
      model: "gpt-4.1-nano",
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "text",
      },
    });
    return res.choices[0].message.content;
  }

  async generatePodcast(summaries) {
    const date = new Date().toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
    const prompt = generatePodcastPrompt(date, summaries.join("\n"));
    const res = await this.openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [{ role: "user", content: prompt }],
      temperature: 1.0,
    });
    return res.choices[0].message.content;
  }

  async improvementLoop(stories, script) {
    let improvedScript = script;

    for (let i = 0; i < 5; i++) {
      const suggestionsRes = await this.openai.chat.completions.create({
        model: "gpt-4.1-nano",
        messages: [
          { role: "user", content: generateSuggestionPrompt(stories.join("\n"), improvedScript) },
        ],
        temperature: 1.0,
      });
      const suggestions = suggestionsRes.choices[0].message.content;

      const improvementRes = await this.openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          {
            role: "user",
            content: generateImprovementPrompt(suggestions, stories.join("\n"), improvedScript),
          },
        ],
        temperature: 1.0,
      });

      improvedScript = improvementRes.choices[0].message.content;
    }

    return improvedScript;
  }
}
