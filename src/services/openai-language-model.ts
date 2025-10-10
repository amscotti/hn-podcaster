import OpenAI from "@openai/openai";
import type { Story } from "../HackerNews.ts";
import { LanguageModelService } from "./interfaces.ts";

const STYLE_SYSTEM_MESSAGE =
  'You are writing a podcast host script to be read aloud. Output must be plain paragraphs only: no bullet points, no numbered lists, no headings, no timestamps, no segment labels or meta sections, and no stage directions or sound cues (e.g., —chime—). Do not include teaser/roadmap/timings or "listener/poll/glossary/recap" sections. Include a warm intro (show name "Hacker Insight", today\'s date, and a short value promise), smooth sentence-level transitions between stories, and a cohesive outro with a brief recap plus a friendly sign-off. Write a natural, engaging monologue and return only paragraphs separated by single blank lines.';

const generateSummaryTalkingPointsPrompt = (text: string): string => {
  return `Create a detailed summary of this page, summarizing the main ideas and creating talking points that would be relevant for someone who hasn't read the article.
For each talking point, please include why it is relevant to the story and details about why you would tell someone this.

## Story
${text}`.trim();
};

const generatePodcastPrompt = (date: string, text: string): string => {
  return `You are writing a podcast host script to be read aloud. The output must be a natural, continuous monologue suitable for direct text-to-speech.

Strict format:
- Plain paragraphs only.
- No bullet points, no numbered lists, no headings, no timestamps, no segment labels (e.g., Teaser:, Topics:, Target timings:), and no meta sections (Glossary, Listener question, Live poll).
- No stage directions or sound cues (e.g., —chime—).
- No emojis or markup.
- Do not include an agenda or roadmap.

Required structure:
- Intro: Greet the audience, name the show ("Hacker Insight"), state today's date, and set a clear value promise in 1–2 sentences (what listeners will gain).
- Body: Cover each story in a clear, engaging way. Weave story titles/sources as part of sentences (not as headings). Between stories, use smooth sentence-level transitions that connect ideas (e.g., "Shifting gears…", "Meanwhile…", "From X to Y…").
- Outro: Provide a brief recap of the main themes or takeaways, then add a friendly sign-off with a soft CTA (e.g., inviting listeners back tomorrow).

Today's date is: ${date}

Stories:
${text}

Final instruction:
- Return ONLY the final monologue text as plain paragraphs separated by single blank lines.
- Before returning, silently scan and rewrite any list-like or labeled content into flowing prose so the output reads naturally from start to finish.`
    .trim();
};

const generateSuggestionPrompt = (
  stories: string,
  podcastScript: string,
): string => {
  return `You are an editor of a podcast script. Provide precise, actionable revisions to improve clarity, flow, and engagement.

Format constraints for the final script:
- Paragraphs only (no bullets, numbered lists, headings, timestamps).
- No labels (Teaser:, Topics:, Target timings:, Glossary, Listener question, Live poll) and no stage directions/sound cues.
- No agenda/roadmap. No emojis.

Focus your suggestions on:
- Intro: Ensure a warm greeting with show name ("Hacker Insight"), today's date, and a concise value promise.
- Transitions: Add or strengthen sentence-level bridges between stories (connect ideas; do not label segments).
- Coverage/clarity: Maintain story order and ensure each story reads as natural prose.

Stories:
${stories}

Current Script:
${podcastScript}`.trim();
};

const generateImprovementPrompt = (
  suggestions: string,
  stories: string,
  podcastScript: string,
): string => {
  return `You are an editor improving a podcast script. Apply the following suggestions to create a better version.

Suggestions to apply:
${suggestions}

Stories (for reference):
${stories}

Current Script:
${podcastScript}

Return the improved script following these constraints:
- Paragraphs only (no bullets, numbered lists, headings, timestamps).
- No labels (Teaser:, Topics:, Target timings:, Glossary, Listener question, Live poll) and no stage directions/sound cues.
- No agenda/roadmap. No emojis.
- Include warm intro with show name ("Hacker Insight"), today's date, and value promise.
- Use smooth sentence-level transitions between stories.
- End with brief recap and friendly sign-off.`.trim();
};

interface OpenAILanguageModelConfig {
  apiKey: string;
  baseURL: string;
  models: {
    summary: string;
    main: string;
  };
}

/**
 * OpenAI implementation of the LanguageModelService interface
 */
export class OpenAILanguageModelService implements LanguageModelService {
  private openai: OpenAI;
  private models: { summary: string; main: string };

  /**
   * @param config - Configuration object
   */
  constructor(config: OpenAILanguageModelConfig) {
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.models = config.models;
  }

  async generateSummary(story: string): Promise<string> {
    const prompt = generateSummaryTalkingPointsPrompt(story);
    const res = await this.openai.chat.completions.create({
      model: this.models.summary,
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "text",
      },
    });
    const content: string = res.choices[0].message.content || "";
    return content;
  }

  async generatePodcast(summaries: string[]): Promise<string> {
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
      model: this.models.main,
      messages: [
        { role: "system", content: STYLE_SYSTEM_MESSAGE },
        { role: "user", content: prompt },
      ],
      temperature: 1.0,
    });
    const content: string = res.choices[0].message.content || "";
    return content;
  }

  async improveScript(
    _stories: Story[],
    summaries: string[],
    script: string,
  ): Promise<string> {
    let improvedScript = script;

    for (let i = 0; i < 5; i++) {
      const suggestionsRes = await this.openai.chat.completions.create({
        model: this.models.summary,
        messages: [
          {
            role: "user",
            content: generateSuggestionPrompt(
              summaries.join("\n"),
              improvedScript,
            ),
          },
        ],
        temperature: 1.0,
      });
      const suggestions: string = suggestionsRes.choices[0].message.content ||
        "";

      const improvementRes = await this.openai.chat.completions.create({
        model: this.models.main,
        messages: [
          { role: "system", content: STYLE_SYSTEM_MESSAGE },
          {
            role: "user",
            content: generateImprovementPrompt(
              suggestions,
              summaries.join("\n"),
              improvedScript,
            ),
          },
        ],
        temperature: 1.0,
      });

      improvedScript = improvementRes.choices[0].message.content || "";
    }

    return improvedScript;
  }
}
