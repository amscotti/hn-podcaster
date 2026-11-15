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
- Pulls top HN comments for community views and opinions on each story
- Generates summaries and talking points using AI agents
- Creates conversational podcast scripts
- Iteratively refines scripts with an agentic improvement loop:
  structured-output suggestions anchored to paragraphs, applied by a
  tool-using editor agent as surgical paragraph edits
- Converts scripts to MP3 audio using xAI (Grok) TTS or OpenAI TTS
- Streams live workflow progress to the console as each step runs
- Saves transcripts and audio to the output directory

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/amscotti/hn-podcaster.git
cd hn-podcaster
```

### 2. Install Bun

Install [Bun](https://bun.sh/) if you haven't already:

```bash
curl -fsSL https://bun.sh/install | bash
```

Or use [mise](https://mise.jdx.dev/) which will automatically use the version
specified in `mise.toml`:

```bash
mise install
```

Then install dependencies:

```bash
bun install
```

### 3. Configure API Keys

Create a `.env` file in the project root:

```env
# AI Provider (optional - auto-detects from available API keys)
# Options: xai, openai, anthropic, google
# AI_PROVIDER=xai

# API Keys (at least one AI provider required)
# For audio: XAI_API_KEY (default voice) or OPENAI_API_KEY (VOICE_PROVIDER=openai)
XAI_API_KEY=your_xai_key_here
# OPENAI_API_KEY=your_openai_key_here
# ANTHROPIC_API_KEY=your_anthropic_key_here
# GOOGLE_GENERATIVE_AI_API_KEY=your_google_key_here
```

**Supported providers and their models:**

| Provider  | Summary Model    | Main Model           |
| --------- | ---------------- | -------------------- |
| xai       | grok-4.7         | grok-4.7             |
| openai    | gpt-6-luna       | gpt-6.1-sol          |
| anthropic | claude-haiku-5-5 | claude-sonnet-5-5    |
| google    | gemini-3.8-flash | gemini-3.1-pro-preview |

**Voice / TTS** defaults to **xAI** (Grok TTS). Set `VOICE_PROVIDER=openai` to
use OpenAI TTS instead, or `SKIP_AUDIO=true` for transcript-only runs.
Note: OpenAI voice `gpt-4o-mini-tts` shuts down Jan 6 2027 and needs a realtime-API migration, so xAI remains the default.

### Optional Settings

```env
# Number of Hacker News stories to include (default: 7)
STORY_COUNT=7

# Number of script improvement iterations (default: 5, 0 skips the improve loop)
IMPROVEMENT_ITERATIONS=5

# Top HN comments to fetch per story for community context (default: 25, 0 disables)
COMMENT_COUNT=25

# Target podcast length in minutes (default: 12)
# Drives the script word count (calibrated to the default voice/speed)
TARGET_DURATION_MINUTES=12

# Output directory for generated files (default: ./output)
OUTPUT_DIR=./output

# Skip audio generation, transcript only (default: false)
# Useful for faster iteration on script quality
SKIP_AUDIO=true

# Voice / Text-to-Speech (optional)
# VOICE_PROVIDER=xai     # xai (default) or openai
# XAI_VOICE_ID=eve       # xAI voice: any built-in (eve, ara, rex, sal, leo,
#                        # luna, orion, ...) or custom id (default: eve).
#                        # Full list: GET https://api.x.ai/v1/tts/voices
# XAI_VOICE_LANGUAGE=en  # BCP-47 code or "auto" (default: en)
# XAI_VOICE_SPEED=0.9    # 0.7-1.5 (default: 0.9)

# Logging (optional)
# LOG_LEVEL=info         # trace | debug | info | warning | error | fatal

# Content Fetching (optional)
# JINA_API_KEY=           # Enables Jina reader fallback (https://r.jina.ai) for
                          # articles that block the direct fetch with bot detection
```

### 4. Run

Generate a podcast:

```bash
bun run start
```

Output files are saved to the `output/` directory.

## Development

Type checking, linting, and formatting (TypeScript + Biome):

```bash
bun run check
```

Auto-fix formatting:

```bash
bun run format
```

Run tests:

```bash
bun test
```

## Project Structure

```
src/
├── mastra/                    # Mastra components
│   ├── agents/               # AI agent definitions
│   │   ├── summary.ts        # Story summarization agent
│   │   ├── podcast.ts        # Script generation agent
│   │   ├── suggestion.ts     # Script editor agent
│   │   ├── improvement.ts    # Script editor + performance director agents
│   │   └── index.ts          # Agent exports
│   ├── steps/                # Workflow step definitions
│   │   ├── fetch-stories.ts  # Fetch HN story IDs
│   │   ├── fetch-metadata.ts # Fetch story details, backfill URL stories
│   │   ├── download-content.ts # Download article text (HTML + PDF), drop failures
│   │   └── index.ts          # Step exports
│   ├── workflows/            # Workflow definitions
│   │   └── podcast-generation.ts
│   └── index.ts              # Central Mastra entry point
├── lib/                      # Support code
│   ├── config.ts             # Configuration with Zod validation
│   ├── providers.ts          # AI provider configuration
│   ├── hackernews.ts         # HN API client
│   ├── http.ts               # fetchWithTimeout helper
│   ├── format-story.ts       # Story formatting & download filtering helpers
│   ├── script-editing.ts     # Paragraph edit state & validation (improve loop)
│   ├── xai-voice.ts          # xAI (Grok) TTS voice provider
│   └── logger.ts             # LogTape configuration
└── __tests__/                # Test files
app.ts                        # Entry point
output/                       # Generated podcasts and transcripts
```

## Architecture

The project uses [Mastra](https://mastra.ai), a TypeScript AI framework, for
workflow orchestration. The workflow is composed of sequential steps:

1. **Fetch Stories** - Get top story IDs from Hacker News
2. **Fetch Metadata** - Resolve details and backfill until `STORY_COUNT` link
   stories
3. **Download Content** - Fetch webpage HTML or PDF and extract text
4. **Generate Summaries** - AI agents create summaries and talking points
5. **Generate Script** - Create initial podcast script from lean summaries
6. **Improve Script** - Agentic refinement loop (skipped when iterations
   is 0): deterministic checks plus windowed/global suggestion passes,
   applied as paragraph-level tool edits and validated before acceptance
7. **Direct Performance** - Voice-performance pass for emotional arc,
   sentence rhythm, pause hierarchy, and restrained delivery tags
8. **Generate Audio** - Synthesize story-sized script segments to MP3 via
   xAI or OpenAI TTS

### AI Agents

Five specialized agents handle different aspects:

- **Summary Agent** - Creates article summaries and talking points
- **Podcast Agent** - Generates the podcast script
- **Suggestion Agent** - Proposes paragraph-anchored script improvements
- **Script Editor Agent** - Applies suggestions via paragraph edit tools
- **Performance Director Agent** - Directs vocal rhythm, emphasis, pauses,
  and emotional movement without changing the facts

## Requirements

- Bun 1.4+ (pinned in `mise.toml`)
- API key for at least one supported AI provider
- xAI API key for default TTS (or OpenAI if `VOICE_PROVIDER=openai`; or
  `SKIP_AUDIO=true`)
