# HackerNews Podcaster

<p align="center">
    <img src="images/A_stout_wizard_in_a_study_speaking_into_mic.jpg" alt="A stout wizard speaking into a microphone" width="600">
</p>

HackerNews Podcaster is a user-friendly JavaScript application that leverages AI
language models to convert the top stories from Hacker News into engaging,
audio-ready podcasts. Compatible with OpenAI and xAI APIs.

⸻

📖 About This Project

Inspired by Hacker News Recap by Wondercraft.ai, this project explores the
capabilities of advanced AI language processing and text-to-speech models.
HackerNews Podcaster fetches the latest stories from Hacker News, summarizes
them succinctly, and then crafts these summaries into conversational scripts,
ultimately generating polished podcast audio automatically.

Compatible with both OpenAI and xAI APIs - configure the base URL to switch
between providers.

Whether you’re keeping up with technology trends or experimenting with AI-driven
content, this tool streamlines podcast creation effortlessly.

⸻

🎧 Example Output

- 📅 April 14, 2025 - 🎤 [Podcast Audio](example/2025-04-14_podcast.mp3) 📝
  [Transcript](example/2025-04-14_podcast.txt)
- 📅 March 25, 2025 - 🎤 [Podcast Audio](example/2025-03-25_podcast.mp3) 📝
  [Transcript](example/2025-03-25_podcast.txt)
- 📅 November 7, 2023 (Older Version) - 🎤
  [Podcast Audio](example/2023-11-07_podcast.mp3) 📝
  [Transcript](example/2023-11-07_podcast.txt)

⸻

🌟 Features

- Automatically fetches and processes top Hacker News stories.
- Uses AI models to generate concise, clear story summaries and suggestions.
- Creates conversational podcast scripts for high-quality, long-form content.
- Iteratively refines the podcast scripts for maximum clarity and engagement.
- Generates professional-quality MP3 audio with text-to-speech models.
- Saves transcripts and audio files neatly organized for easy access.

⸻

🚀 Quick Setup

Follow these simple steps to get the application up and running:

🔧 Step 1: Clone the repository

```bash
git clone https://github.com/amscotti/hn-podcaster.git
cd hn-podcaster
```

📦 Step 2: Install Dependencies

```bash
bun install
```

🔑 Step 3: Configure API Keys and Models

Set your API keys for general AI operations and text-to-speech:

```bash
export GENERAL_AI_API_KEY=your_general_ai_key    # For xAI or other providers (required)
export GENERAL_AI_BASE_URL=https://api.x.ai/v1
export GENERAL_AI_MODEL_SUMMARY=grok-beta
export GENERAL_AI_MODEL_MAIN=grok-beta

export OPENAI_API_KEY=your_openai_key            # For TTS (required)
export OPENAI_TTS_BASE_URL=https://api.openai.com/v1
export OPENAI_MODEL_TTS=gpt-4o-mini-tts
```

Or create a .env file at the project root:

```
GENERAL_AI_API_KEY=your_general_ai_key
GENERAL_AI_BASE_URL=https://api.x.ai/v1
GENERAL_AI_MODEL_SUMMARY=grok-beta
GENERAL_AI_MODEL_MAIN=grok-beta

OPENAI_API_KEY=your_openai_key
OPENAI_TTS_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL_TTS=gpt-4o-mini-tts
```

🎙️ Step 4: Generate Podcast

Run the application to create your podcast:

```bash
bun run app.js
```

Generated audio files and transcripts are stored in the output/ directory.

⸻

📂 Project Structure

- `src/`: Core modules (HackerNews.ts, PodcastCreator.ts, PodcastRecorder.ts,
  config.ts)
- `src/services/`: Service layer with interfaces and implementations
- `app.ts`: Main application entry point
- `output/`: Generated podcasts and transcripts
- `example/`: Example outputs for quick reference

⸻

⸻

🛠️ Technical Overview

This project utilizes cutting-edge technologies, including:

- **TypeScript** with Bun runtime for performance and type safety
- OpenAI-compatible APIs (OpenAI and xAI) for language models and text-to-speech
- Service-oriented architecture with dependency injection for easy provider
  swapping
- Centralized configuration system (`src/config.ts`) for environment management
- Biome.js for standardized code formatting and linting

The service architecture uses interfaces to define contracts, making it easy to
add support for additional AI providers in the future. Services are injected
into components via constructor dependency injection.

Helpful Development Commands

- Linting: `bun lint`
- Formatting: `bun format`

⸻

📌 Requirements

- [Bun](https://bun.sh/) runtime
- API key for OpenAI or xAI with access to compatible language and TTS models

⸻

Enjoy effortlessly generating engaging technology podcasts with HackerNews
Podcaster!
