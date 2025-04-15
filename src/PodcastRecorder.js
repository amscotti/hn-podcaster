import fs from "fs";
import path from "path";
import OpenAI from "openai";

/**
 * PodcastRecorder handles text-to-speech synthesis and concatenation of audio files for podcast generation.
 */
export default class PodcastRecorder {
  /**
   * Creates a new PodcastRecorder instance.
   */
  constructor() {
    this.openai = new OpenAI();
  }

  /**
   * Creates a podcast audio recording from the provided text, saving the result to the specified file path.
   * Splits the text into paragraph chunks, synthesizes each chunk, and concatenates the resulting MP3 files.
   *
   * @param {string} podcastText - The full podcast script to synthesize.
   * @param {string} filePath - The output file path for the final MP3.
   * @returns {Promise<void>}
   */
  async createRecording(podcastText, filePath) {
    // Split by paragraph (double newline) for more natural chunking
    const textChunks = podcastText
      .split(/\n\s*\n/)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0);

    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];

      const mp3 = await this.openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: "nova",
        input: chunk,
        instructions:
          "You are podcaster reading today's latest news articles to your audience, will be excitement and intriguing this in your voice to engage the readers and entertain them. Ensure you add pauses in between what you're saying to emphasize",
      });

      const buffer = Buffer.from(await mp3.arrayBuffer());
      const partFilePath = filePath.replace(/(\.mp3)$/, `-${i}$1`);
      await fs.promises.writeFile(partFilePath, buffer);
    }

    const directory = path.dirname(filePath);
    await this.concatenateMP3Files(directory, filePath, textChunks.length);
  }

  /**
   * Concatenates multiple MP3 chunk files into a single output MP3 file and deletes the chunk files.
   *
   * @param {string} directory - The directory containing the chunk files.
   * @param {string} outputFilename - The path for the final concatenated MP3 file.
   * @param {number} chunkCount - The number of chunk files to concatenate.
   * @returns {Promise<void>}
   */
  async concatenateMP3Files(directory, outputFilename, chunkCount) {
    // Gather chunk files in order
    const partFiles = [];
    for (let i = 0; i < chunkCount; i++) {
      const partFilePath = outputFilename.replace(/(\.mp3)$/, `-${i}$1`);
      partFiles.push(partFilePath);
    }

    // Concatenate all chunk files into the output file
    const writeStream = fs.createWriteStream(outputFilename);
    for (const partFile of partFiles) {
      const data = await fs.promises.readFile(partFile);
      writeStream.write(data);
    }
    writeStream.end();

    // Wait for the stream to finish
    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    // Delete the chunk files
    for (const partFile of partFiles) {
      try {
        await fs.promises.unlink(partFile);
      } catch (err) {
        console.error("Error deleting file:", partFile, err);
      }
    }
  }
}
