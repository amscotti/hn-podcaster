import OpenAI from "openai";

export default class PodcastRecorder {
  constructor() {
    this.openai = new OpenAI();
  }

  async createRecording(podcastText, filePath) {
    const mp3 = await this.openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "nova",
      input: podcastText,
      instructions:
        "You are podcaster reading today's latest news articles to your audience, will be excitement and intriguing this in your voice to engage the readers and entertain them. Ensure you add pauses in between what you're saying to emphasize",
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    await Bun.write(filePath, buffer);
  }
}
