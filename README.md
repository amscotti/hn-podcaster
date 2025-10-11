# HackerNews Podcaster

<p align="center">
    <img src="images/A_stout_wizard_in_a_study_speaking_into_mic.jpg" alt="A stout wizard speaking into a microphone" width="600">
</p>

A TypeScript application that converts top Hacker News stories into podcast
audio using AI. Works with any OpenAI-compatible API.

## About

Inspired by Hacker News Recap by Wondercraft.ai, this tool fetches top stories
from Hacker News, summarizes them using AI language models, generates a
conversational podcast script, and converts it to audio.

The project works with any OpenAI-compatible API provider. You can use OpenAI's
models, xAI's Grok models, or any other compatible service. Simply configure the
base URL and model names - no code changes needed.

## Example Output

- [April 14, 2025 Podcast](example/2025-04-14_podcast.mp3)
  ([Transcript](example/2025-04-14_podcast.txt))
- [March 25, 2025 Podcast](example/2025-03-25_podcast.mp3)
  ([Transcript](example/2025-03-25_podcast.txt))
- [November 7, 2023 Podcast](example/2023-11-07_podcast.mp3)
  ([Transcript](example/2023-11-07_podcast.txt))

## Features

- Fetches top stories from Hacker News
- Generates summaries and talking points using AI
- Creates conversational podcast scripts
- Iteratively refines scripts for clarity
- Converts scripts to MP3 audio
- Saves transcripts and audio to the output directory

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/amscotti/hn-podcaster.git
cd hn-podcaster
```

### 2. Install Deno

Install [Deno](https://deno.land/) if you haven't already:

```bash
curl -fsSL https://deno.land/x/install/install.sh | sh
```

Or use [mise](https://mise.jdx.dev/) which will automatically use the version
specified in `mise.toml`:

```bash
mise install
```

### 3. Configure API Keys

Create a `.env` file in the project root. The example below uses xAI's Grok
models for text generation and OpenAI for text-to-speech:

```env
# General AI (for summaries and script generation)
GENERAL_AI_API_KEY=your_api_key
GENERAL_AI_BASE_URL=https://api.x.ai/v1
GENERAL_AI_MODEL_SUMMARY=grok-4-fast-non-reasoning
GENERAL_AI_MODEL_MAIN=grok-4-fast

# Text-to-Speech
OPENAI_API_KEY=your_openai_key
OPENAI_TTS_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL_TTS=gpt-4o-mini-tts
```

**Using other providers:** Any OpenAI-compatible API works. Just set the
`GENERAL_AI_BASE_URL` to your provider's endpoint and use their model names. For
example, to use OpenAI for everything, set
`GENERAL_AI_BASE_URL=https://api.openai.com/v1` and use model names like
`gpt-4o` or `gpt-4o-mini`.

### 4. Run

Generate a podcast:

```bash
deno task start
```

Output files are saved to the `output/` directory.

## Development

Type checking, linting, and formatting:

```bash
deno task check
```

Run tests:

```bash
deno task test
```

## Project Structure

- `src/` - Core application code
  - `services/` - Service layer with interfaces and implementations
  - `workflows/` - High-level workflow orchestration
  - `shared/` - Shared utilities (errors, logging)
- `app.ts` - Main entry point
- `output/` - Generated podcasts and transcripts
- `example/` - Example outputs

## Architecture

The project uses a service-based architecture with dependency injection. AI
providers are abstracted behind interfaces, so you can use any OpenAI-compatible
API (OpenAI, xAI, locally hosted models, etc.) by just changing the
configuration - no code changes required.

Core components:

- **HackerNews.ts** - Fetches stories from the Hacker News API
- **PodcastCreator.ts** - Orchestrates summarization and script generation
- **PodcastRecorder.ts** - Converts scripts to audio
- **workflows/** - Coordinates the full pipeline with error handling

## Requirements

- Deno 2.5+
- API key for any OpenAI-compatible provider (OpenAI, xAI, etc.)
