# HackerNews Podcaster

<p align="center">
    <img src="images/A_stout_wizard_in_a_study_speaking_into_mic.jpg" alt="A stout wizard speaking into a microphone" width="600">
</p>

HackerNews Podcaster is a user-friendly JavaScript application that leverages OpenAI’s powerful GPT-4.1 language models (nano and flagship) to convert the top stories from Hacker News into engaging, audio-ready podcasts.

⸻

📖 About This Project

Inspired by Hacker News Recap by Wondercraft.ai, this project explores the capabilities of OpenAI’s advanced language processing and text-to-speech models. HackerNews Podcaster fetches the latest stories from Hacker News, summarizes them succinctly, and then crafts these summaries into conversational scripts, ultimately generating polished podcast audio automatically.

Whether you’re keeping up with technology trends or experimenting with AI-driven content, this tool streamlines podcast creation effortlessly.

⸻

🎧 Example Output
- 📅 April 14, 2025 - 🎤 [Podcast Audio](example/2025-04-14_podcast.mp3) 📝 [Transcript](example/2025-04-14_podcast.txt)
- 📅 March 25, 2025 - 🎤 [Podcast Audio](example/2025-03-25_podcast.mp3) 📝 [Transcript](example/2025-03-25_podcast.txt)
- 📅 November 7, 2023 (Older Version) - 🎤 [Podcast Audio](example/2023-11-07_podcast.mp3) 📝 [Transcript](example/2023-11-07_podcast.txt)

⸻

🌟 Features
- Automatically fetches and processes top Hacker News stories.
- Uses OpenAI GPT-4.1-nano to generate concise, clear story summaries and suggestions.
- Creates conversational podcast scripts with GPT-4.1 (flagship) for high-quality, long-form content.
- Iteratively refines the podcast scripts for maximum clarity and engagement.
- Generates professional-quality MP3 audio with OpenAI’s latest TTS models.
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

🔑 Step 3: Configure API Key

Set your OpenAI API key in your environment:

```bash
export OPENAI_API_KEY=your_api_key_here
```

Or create a .env file at the project root:

```
OPENAI_API_KEY=your_api_key_here
```

🎙️ Step 4: Generate Podcast

Run the application to create your podcast:

```bash
bun run app.js
```

Generated audio files and transcripts are stored in the output/ directory.

⸻

📂 Project Structure
- src/: Core modules (HackerNews.js, PodcastCreator.js, PodcastRecorder.js)
- app.js: Main application entry point
- output/: Generated podcasts and transcripts
- example/: Example outputs for quick reference

⸻

🛠️ Technical Overview

This project utilizes cutting-edge technologies, including:
- JavaScript with Bun runtime for performance and efficiency
- OpenAI API (GPT-4.1 flagship, GPT-4.1-nano, and Text-to-Speech)
- Biome.js for standardized code formatting and linting

Helpful Development Commands
- Linting: `bun lint`
- Formatting: `bun format`

⸻

📌 Requirements
- [Bun](https://bun.sh/) runtime
- OpenAI API key with access to GPT-4.1 (flagship, nano) and TTS models

⸻

Enjoy effortlessly generating engaging technology podcasts with HackerNews Podcaster!
