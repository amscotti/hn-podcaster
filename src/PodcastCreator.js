import { convert } from "html-to-text";
import OpenAI from "openai";

const generateSummaryTalkingPointsPrompt = (text) => {
  return `Create a detailed summary of this page, going over the main ideas along with creating talking points that would be relevant when discussing the article to someone who hasn't read it.
  For each talking point, please include why this is relevant to the story and details of why you would tell someone this.

## Story
${text}`.trim();
};

const generatePodcastPrompt = (date, text) => {
  return `I need you to follow this specific task. Keeping in mind a 20-minute duration, construct a podcast script from a list of stories from HackerNews called "Hacker Insight".

Here is how the podcast should be structured:

1. Start with an introduction detailing the topics of the day which are to be discussed.
2. Then delve into a detailed discussion on each topic utilizing the provided summaries along with the title of the article for context.
3. Endeavor to create smooth transitions between the topics as you progress through the podcast.
4. The podcast should conclude with an outro giving a quick recap of the covered topics and an inviting reminder for the audience to join in for the next podcast tomorrow.
5. You should be engaging and interested in the topics near covering.
6. Don't treat this as just a summary, engage in the topic and ensure to cover the talking points for each story.

Please, remember that I only need the text representation (what the listeners would hear) of the podcast. Thus, exclude any stage directions, categorizations, audio cues, or labels such as '[Intro]', '[Topic]', '[Transition]'. Focus purely on the spoken content of the podcast.

Today's date is: ${date}

# Stories

${text}

Please return just the text for the podcast without any additional dialogue.`.trim();
};

const generateSuggestionPrompt = (stories, podcastScript) => {
  return `You are an editor of a podcast script. You will review the following script and create a list of suggested precise updates to improve content, 
  
  Areas that you're focusing on are,
  - Is there enough length to each topic to properly cover it and providing the listener with enough details?
  - Have all the suggested talking points been covered?
  - Is the podcast engaging, Does the user want to listen until the end?
  - Is there proper transition between the topics that feel natural?
  - Is there a proper intro covering with the show will offer?
  - Is there a proper outro summarizing the topics covered?

  You should generate a list of suggestions that can be used to improve the transcript, but maintain the current structure.
  Here is an example of bad suggestion, "Make transitions better", and here is a better one "The transition between the first topic and the second topic doesn't feel smooth, I would suggest trying to link the two topics together because of how similar they are"
  
  ## Podcast Script
  ${podcastScript}

  ## Stories
  ${stories}
  `.trim();
};

const generateImprovementPrompt = (suggestions, stories, podcastScript) => {
  return `You're working on improving a podcast script, your editor has provided you with some suggested improvements that you will apply to the script.

  You will edit the script with these rules in mine,
  - You will leave the script in its current format
  - You will make the minimum amount of changes based upon the suggestions
  - You can enhance any of the topics covered
  - You will not add any additional topics, not covered already by the script
  - Your output will only be the script itself and nothing else. This includes no additional formatting or emojis, just the text.

  ## Suggestions
  ${suggestions}

  ## Podcast Script
  ${podcastScript}

  Again, it is important that you only submit the text for the updated script, and no other remarks, comments, formatting or emojis.
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
      model: "o3-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "text",
      },
      reasoning_effort: "low",
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
      model: "gpt-4.5-preview",
      messages: [{ role: "user", content: prompt }],
      temperature: 1.0,
    });
    return res.choices[0].message.content;
  }

  async improvementLoop(stories, script) {
    let improvedScript = script;

    for (let i = 0; i < 5; i++) {
      const suggestionsRes = await this.openai.chat.completions.create({
        model: "o3-mini",
        messages: [
          { role: "user", content: generateSuggestionPrompt(stories.join("\n"), improvedScript) },
        ],
        temperature: 1.0,
        reasoning_effort: "low",
      });
      const suggestions = suggestionsRes.choices[0].message.content;

      const improvementRes = await this.openai.chat.completions.create({
        model: "gpt-4.5-preview",
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
