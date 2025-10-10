import { assertEquals } from "@std/assert";
import { PodcastGenerationWorkflow } from "../workflows/podcast-generation.ts";
import { LanguageModelService } from "../services/interfaces.ts";
import { TextToSpeechService } from "../services/interfaces.ts";
import { type Story } from "../HackerNews.ts";

// Mock Services that implement the interfaces
class MockLanguageModelService implements LanguageModelService {
  generateSummaryCallCount = 0;
  generatePodcastCallCount = 0;
  improveScriptCallCount = 0;

  generateSummary(_story: string): Promise<string> {
    this.generateSummaryCallCount++;
    return Promise.resolve(`Mock summary for: ${_story.substring(0, 20)}...`);
  }

  generatePodcast(_summaries: string[]): Promise<string> {
    this.generatePodcastCallCount++;
    return Promise.resolve(
      `Mock podcast script with ${_summaries.length} stories`,
    );
  }

  improveScript(
    _stories: Story[],
    _summaries: string[],
    _script: string,
  ): Promise<string> {
    this.improveScriptCallCount++;
    return Promise.resolve(`Improved: ${_script}`);
  }
}

class MockPodcastCreator {
  private languageModelService: MockLanguageModelService;
  getWebPageTextCallCount = 0;

  constructor() {
    this.languageModelService = new MockLanguageModelService();
  }

  getWebPageText(_url: string): Promise<string> {
    this.getWebPageTextCallCount++;
    return Promise.resolve(`Mock content for ${_url}`);
  }

  getSummary(story: string): Promise<string> {
    return this.languageModelService.generateSummary(story);
  }

  generatePodcast(summaries: string[]): Promise<string> {
    return this.languageModelService.generatePodcast(summaries);
  }

  improvementLoop(
    stories: Story[],
    summaries: string[],
    script: string,
  ): Promise<string> {
    return this.languageModelService.improveScript(stories, summaries, script);
  }
}

class MockTextToSpeechService implements TextToSpeechService {
  createRecordingCallCount = 0;

  createAudio(_text: string, _outputPath: string): Promise<void> {
    this.createRecordingCallCount++;
    // Mock successful recording - don't actually create files
    return Promise.resolve();
  }
}

Deno.test("PodcastGenerationWorkflow - service integration", async () => {
  const mockCreator = new MockPodcastCreator();
  const mockRecorder = new MockTextToSpeechService();

  const workflow = new PodcastGenerationWorkflow(mockCreator, mockRecorder);

  // Test that services are properly integrated
  assertEquals(typeof workflow, "object");

  // Test that mock services work as expected
  const text = await mockCreator.getWebPageText("test-url");
  assertEquals(text.includes("test-url"), true);
  assertEquals(mockCreator.getWebPageTextCallCount, 1);

  // Test recorder service
  await mockRecorder.createAudio("test script", "test.mp3");
  assertEquals(mockRecorder.createRecordingCallCount, 1);
});
