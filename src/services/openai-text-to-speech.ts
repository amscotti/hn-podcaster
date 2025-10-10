import OpenAI from "@openai/openai";
import { TextToSpeechService } from "./interfaces.ts";

interface OpenAITextToSpeechConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

/**
 * OpenAI implementation of the TextToSpeechService interface
 */
export class OpenAITextToSpeechService implements TextToSpeechService {
  private openai: OpenAI;
  private model: string;

  constructor(config: OpenAITextToSpeechConfig) {
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.model = config.model;
  }

  async createAudio(text: string, outputPath: string): Promise<void> {
    // Split text into chunks for processing
    const textChunks = text
      .split(/\n\s*\n/)
      .map((chunk: string) => chunk.trim())
      .filter((chunk: string) => chunk.length > 0);

    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];

      const mp3 = await this.openai.audio.speech.create({
        model: this.model,
        voice: "nova",
        input: chunk,
        instructions:
          "You are podcaster reading today's latest news articles to your audience, will be excitement and intriguing this in your voice to engage the readers and entertain them. Ensure you add pauses in between what you're saying to emphasize",
      });

      const buffer = new Uint8Array(await mp3.arrayBuffer());
      const partFilePath = outputPath.replace(/(\.mp3)$/, `-${i}$1`);
      await Deno.writeFile(partFilePath, buffer);
    }

    await this.concatenateMP3Files(outputPath, textChunks.length);
  }

  /**
   * Concatenates multiple MP3 chunk files into a single output MP3 file and deletes the chunk files.
   */
  async concatenateMP3Files(
    outputFilename: string,
    chunkCount: number,
  ): Promise<void> {
    // Gather chunk files in order
    const partFiles: string[] = [];
    for (let i = 0; i < chunkCount; i++) {
      const partFilePath = outputFilename.replace(/(\.mp3)$/, `-${i}$1`);
      partFiles.push(partFilePath);
    }

    // Concatenate all chunk files into the output file
    const outputFile = await Deno.open(outputFilename, {
      write: true,
      create: true,
    });
    try {
      for (const partFile of partFiles) {
        const data = await Deno.readFile(partFile);
        await outputFile.write(data);
      }
    } finally {
      outputFile.close();
    }

    // Delete the chunk files
    for (const partFile of partFiles) {
      try {
        await Deno.remove(partFile);
      } catch (err) {
        console.error("Error deleting file:", partFile, err);
      }
    }
  }
}
