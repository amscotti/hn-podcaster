import { TextToSpeechService } from "./services/interfaces.ts";

/**
 * PodcastRecorder handles text-to-speech synthesis and audio file concatenation.
 */
export default class PodcastRecorder {
  private textToSpeechService: TextToSpeechService;

  constructor(textToSpeechService: TextToSpeechService) {
    this.textToSpeechService = textToSpeechService;
  }

  /**
   * Creates a podcast audio recording from the provided text, saving the result to the specified file path.
   * Splits the text into paragraph chunks, synthesizes each chunk, and concatenates the resulting MP3 files.
   */
  async createRecording(podcastText: string, filePath: string): Promise<void> {
    await this.textToSpeechService.createAudio(podcastText, filePath);
  }
}
