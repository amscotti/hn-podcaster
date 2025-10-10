import type { Story } from "../HackerNews.ts";

/**
 * Interface for language model services
 * Defines the contract for AI-powered text generation operations
 */
export interface LanguageModelService {
  /**
   * Generate a summary of a story
   */
  generateSummary(story: string): Promise<string>;

  /**
   * Generate a complete podcast script from story summaries
   */
  generatePodcast(summaries: string[]): Promise<string>;

  /**
   * Improve an existing podcast script through iterative refinement
   */
  improveScript(
    stories: Story[],
    summaries: string[],
    script: string,
  ): Promise<string>;
}

/**
 * Interface for podcast creation services
 * Defines the contract for creating podcast content from stories
 */
export interface PodcastCreatorService {
  /**
   * Fetch webpage content from a URL
   */
  getWebPageText(url: string): Promise<string>;

  /**
   * Generate a summary for a story
   */
  getSummary(story: string): Promise<string>;

  /**
   * Generate a podcast script from story summaries
   */
  generatePodcast(summaries: string[]): Promise<string>;

  /**
   * Improve a podcast script through iterative refinement
   */
  improvementLoop(
    stories: Story[],
    summaries: string[],
    script: string,
  ): Promise<string>;
}

/**
 * Interface for text-to-speech services
 * Defines the contract for converting text to audio
 */
export interface TextToSpeechService {
  /**
   * Convert text to audio and save to file
   */
  createAudio(text: string, outputPath: string): Promise<void>;
}
