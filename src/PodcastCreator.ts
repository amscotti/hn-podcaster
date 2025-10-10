import { convert } from "html-to-text";
import type { Story } from "./HackerNews.ts";
import { LanguageModelService } from "./services/interfaces.ts";

/**
 * PodcastCreator handles the generation of podcast content from Hacker News stories
 */
export default class PodcastCreator {
  private languageModelService: LanguageModelService;

  constructor(languageModelService: LanguageModelService) {
    this.languageModelService = languageModelService;
  }

  async getWebPageText(url: string): Promise<string> {
    const response = await fetch(url);
    try {
      return convert(await response.text(), { wordwrap: 130 });
    } catch (_error) {
      return "";
    }
  }

  async getSummary(story: string): Promise<string> {
    return await this.languageModelService.generateSummary(story);
  }

  async generatePodcast(summaries: string[]): Promise<string> {
    return await this.languageModelService.generatePodcast(summaries);
  }

  async improvementLoop(
    stories: Story[],
    summaries: string[],
    script: string,
  ): Promise<string> {
    return await this.languageModelService.improveScript(
      stories,
      summaries,
      script,
    );
  }
}
