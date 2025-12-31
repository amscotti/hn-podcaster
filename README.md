# HackerNews Podcaster

<p align="center">
    <img src="images/A_stout_wizard_in_a_study_speaking_into_mic.jpg" alt="A stout wizard speaking into a microphone" width="600">
</p>

A TypeScript application that converts top Hacker News stories into podcast
audio using AI. Built with [Mastra](https://mastra.ai) for workflow
orchestration and supports multiple AI providers.

## About

Inspired by Hacker News Recap by Wondercraft.ai, this tool fetches top stories
from Hacker News, summarizes them using AI language models, generates a
conversational podcast script, and converts it to audio.

## Example Output

- [April 14, 2025 Podcast](example/2025-04-14_podcast.mp3)
  ([Transcript](example/2025-04-14_podcast.txt))
- [March 25, 2025 Podcast](example/2025-03-25_podcast.mp3)
  ([Transcript](example/2025-03-25_podcast.txt))
- [November 7, 2023 Podcast](example/2023-11-07_podcast.mp3)
  ([Transcript](example/2023-11-07_podcast.txt))

## Features

- Fetches top stories from Hacker News
- Downloads and extracts text from webpages and PDFs
- Generates summaries and talking points using AI agents
- Creates conversational podcast scripts
- Iteratively refines scripts (configurable improvement loops)
- Converts scripts to MP3 audio using OpenAI TTS
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

Create a `.env` file in the project root:

```env
# AI Provider (optional - auto-detects from available API keys)
# Options: xai, openai, anthropic, google
# AI_PROVIDER=xai

# API Keys (at least one AI provider required, OpenAI required for voice)
XAI_API_KEY=your_xai_key_here
OPENAI_API_KEY=your_openai_key_here
# ANTHROPIC_API_KEY=your_anthropic_key_here
# GOOGLE_GENERATIVE_AI_API_KEY=your_google_key_here
```

**Supported providers and their models:**

| Provider  | Summary Model               | Main Model             |
| --------- | --------------------------- | ---------------------- |
| xai       | grok-4-1-fast-non-reasoning | grok-4-1-fast          |
| openai    | gpt-5-mini                  | gpt-5.2                |
| anthropic | claude-haiku-4-5            | claude-sonnet-4-5      |
| google    | gemini-3-pro-preview        | gemini-3-flash-preview |

OpenAI is always required for text-to-speech (unless `SKIP_AUDIO=true`).

### Optional Settings

```env
# Number of Hacker News stories to include (default: 10)
STORY_COUNT=10

# Number of script improvement iterations (default: 5)
IMPROVEMENT_ITERATIONS=5

# Output directory for generated files (default: ./output)
OUTPUT_DIR=./output

# Skip audio generation, transcript only (default: false)
# Useful for faster iteration on script quality
SKIP_AUDIO=true
```

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

```
src/
├── mastra/                    # Mastra components
│   ├── agents/               # AI agent definitions
│   │   ├── summary.ts        # Story summarization agent
│   │   ├── podcast.ts        # Script generation agent
│   │   ├── suggestion.ts     # Script editor agent
│   │   ├── improvement.ts    # Script improver agent
│   │   └── index.ts          # Agent exports
│   ├── steps/                # Workflow step definitions
│   │   ├── fetch-stories.ts  # Fetch HN story IDs
│   │   ├── fetch-metadata.ts # Fetch story details
│   │   ├── download-content.ts # Download article text (HTML + PDF)
│   │   └── index.ts          # Step exports
│   ├── workflows/            # Workflow definitions
│   │   └── podcast-generation.ts
│   └── index.ts              # Central Mastra entry point
├── lib/                      # Support code
│   ├── config.ts             # Configuration with Zod validation
│   ├── providers.ts          # AI provider configuration
│   ├── hackernews.ts         # HN API client
│   └── logger.ts             # LogTape configuration
└── __tests__/                # Test files
app.ts                        # Entry point
output/                       # Generated podcasts and transcripts
```

## Architecture

The project uses [Mastra](https://mastra.ai), a TypeScript AI framework, for
workflow orchestration. The workflow is composed of sequential steps:

1. **Fetch Stories** - Get top story IDs from Hacker News
2. **Fetch Metadata** - Get story details and filter for valid URLs
3. **Download Content** - Fetch webpage HTML or PDF and extract text
4. **Generate Summaries** - AI agents create summaries and talking points
5. **Generate Script** - Create initial podcast script
6. **Improve Script** - Iterative refinement (suggest → apply)
7. **Generate Audio** - Convert script to MP3 via OpenAI TTS

### AI Agents

Four specialized agents handle different aspects:

- **Summary Agent** - Creates article summaries and talking points
- **Podcast Agent** - Generates the podcast script
- **Suggestion Agent** - Proposes script improvements
- **Improvement Agent** - Applies suggested improvements

## Requirements

- Deno 2.5+
- API key for at least one supported AI provider
- OpenAI API key (required for text-to-speech, unless skipping audio)
