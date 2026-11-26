# AGENTS.md

Guidance for OpenCode sessions working in this repo. Only non-obvious,
repo-specific facts are included.

## Toolchain

- **Bun project** (migrated from Deno in Oct 2026 after the Cloudflare
  acquisition put Deno on a ~1-year maintenance wind-down). Dependencies are
  in `package.json` / `bun.lock`; install with `bun install`. Bun is pinned
  to 1.4.3 in `mise.toml`; run `mise install` or use any Bun 1.4+.
- Bun auto-loads `.env` — no `--env-file` flag needed.
- Imports keep `.ts` extensions (`allowImportingTsExtensions` in
  `tsconfig.json`, `moduleResolution: "bundler"`). Don't strip them.
- Lint + format is **Biome** (`biome.json`), type checking is `tsc`, tests
  are `bun:test`.

## Commands

```bash
bun run start   # run the podcast pipeline (auto-loads .env)
bun run check   # tsc --noEmit && biome check .
bun run format  # biome format --write .
bun test        # run the test suite
```

- **Verify with `bun run check` and `bun test` before considering work
  done.** `tsc` checks `app.ts` + `src/` (see `tsconfig.json` includes).
- **There is no CI for tests or lint.** The only GitHub workflow
  (`.github/workflows/opencode-review.yml`) runs an OpenCode PR review. The
  local `check` + `test` scripts are the real gate.
- Run a single test with `bun test --test-name-pattern "fetchTopStories"` or
  pass a path: `bun test src/__tests__/hackernews.test.ts`.
- Tests stub `globalThis.fetch` by hand (see `stubFetch` in the test files);
  no mock library is used.

## Dependency security

- Bun does **not** run dependency `postinstall` scripts unless a package is
  listed in `trustedDependencies`. Do not add entries there casually — that
  is the main install-time malware vector Bun leaves open.
- The `@mastra/*` scope was compromised in June 2026 (the `easy-day-js`
  typosquat; `@mastra/core@1.42.1` and ~140 sibling packages). The current
  pin (`@mastra/core@1.78.0`) is a post-incident release with npm provenance
  attestations and no `easy-day-js` in its tree (`@mastra/voice-openai` was
  removed when OpenAI voice migrated to the hand-rolled Realtime client).
  Keep Mastra packages **exact-pinned**, and when bumping, check the new tree
  for unexpected deps before trusting it.

## Runtime gotchas

- **A valid `.env` is required to run `app.ts`** (or anything importing
  `src/lib/config.ts`). `config.ts` loads and validates at module
  initialization and throws immediately if no AI provider API key is
  present. `bun test` runs without a `.env` because the `bunfig.toml` `[test]`
  preload (`src/__tests__/preload.ts`) seeds placeholder keys before any
  module import; it never overwrites real env values.
- Voice defaults to **xAI Eve at speed 0.9** (`src/lib/config.ts`).
  `XAI_VOICE_ID`, `XAI_VOICE_SPEED`, `VOICE_PROVIDER=openai` (with
  `OPENAI_VOICE_ID`, `OPENAI_VOICE_SPEED`, and `ffmpeg` on `PATH`), or
  `SKIP_AUDIO=true` override it. `LOG_LEVEL` controls LogTape verbosity.
  Episode defaults are 7 stories / 12 minutes; word budgets use the
  measured `TARGET_WORDS_PER_MINUTE` in the workflow, not 140 wpm.
- **Zero downloadable stories is a hard failure.** `download-content` throws
  when no candidates yield content (e.g. total article-fetch outage), so
  `bun run start` exits non-zero instead of writing an empty episode. Wrap
  scheduled runs accordingly.
- **Untrusted input:** The pipeline ingests arbitrary web content (articles,
  HN comments) and treats it as data, fencing it in
  `<<<UNTRUSTED_SOURCE … UNTRUSTED_SOURCE>>>` for the summary prompt.
  Prompt injection is mitigated, not eliminated — an accepted residual risk.
- `app.ts` ends with an explicit `process.exit(0)` because Mastra's
  streaming machinery and the AI HTTP clients keep the event loop alive. Do
  not remove it.

## Don't "fix" these on instinct

- **Custom `XaiVoice` in `src/lib/xai-voice.ts`.** There is no
  `@mastra/voice-xai` package (still true at Mastra 1.78), so the xAI TTS
  provider is hand-rolled against the `MastraVoice` contract. It uses the
  TTS **REST** endpoint, which has no model-version parameter. "Grok Voice
  3.0" is xAI's separate realtime Voice Agent (speech-to-speech) API — not
  a fit for rendering a fixed script to MP3, and intentionally unused.
- **Custom `OpenAIRealtimeVoice` in `src/lib/openai-realtime-voice.ts`.**
  OpenAI's legacy `gpt-4o-mini-tts` REST model shuts down Jan 6, 2027 and
  its replacement (`gpt-realtime-2.1-mini`) is Realtime-API only. Rather than
  pulling in `@mastra/voice-openai-realtime` (extra Mastra supply-chain
  surface) or `ws`, this provider uses Bun's native `WebSocket` against the
  GA Realtime API (omitting the retired `OpenAI-Beta: realtime=v1` header)
  and pipes the 24kHz PCM16 output through `ffmpeg` via `Bun.spawn`
  (`-write_xing 0 -id3v2_version 0` for headerless CBR MP3 concat).
  `@mastra/voice-openai` has been removed.
- **Structural `VoiceLike` interface in `src/lib/providers.ts`.** It is
  intentional: `MastraVoice` types `speak()` with Node's `ReadableStream`
  while our providers return web `ReadableStream<Uint8Array>`, so keeping a
  minimal `AsyncIterable<unknown>` interface decouples the workflow. Leave it.

## Architecture pointers

- Workflow lives in `src/mastra/workflows/podcast-generation.ts` and is the
  spine of the app: fetch stories → metadata → download content → summarize
  → script → improve loop (`dowhile`) → performance director → TTS audio.
  `app.ts` just streams it. TTS synthesizes story-sized multi-paragraph
  segments (not one call per paragraph) so prosody carries across
  transitions; later segments start with a synthesized `[long-pause]`.
- The improve loop is **agentic by design**: suggestions are collected via
  deterministic checks (`src/lib/script-editing.ts`) plus windowed/global
  structured-output passes anchored to paragraph ids, then applied by a
  tool-using editor agent (`createScriptEditorAgent`, fresh per iteration)
  as paragraph-level edits with validation and fallback to the prior
  script. Do not collapse this back into whole-episode mega-calls:
  grok-4.7 exceeds the ~300s per-request ceiling on those (measured
  Oct 2026; see the model-table comment in `src/lib/providers.ts`).
- Adding/changing an AI provider touches **two** files: the model table in
  `src/lib/providers.ts` and the provider id list + env-key map in
  `src/lib/config.ts`.
- `@mastra/core` is pinned to `1.78.0` (exact version in `package.json`;
  `@mastra/voice-openai` has been removed). Bump deliberately.
- Bun-native APIs are used deliberately where they help: `Bun.write` /
  `Bun.file().writer()` for transcript + MP3 output (chunk audio streams
  into one file sink; no temp part-files), `Bun.sleep` for download retry
  backoff, `Bun.env` for configuration.

## Mastra help

- A local Mastra skill ships at `.agents/skills/mastra/` (excluded from
  type checking via `tsconfig.json` and from Biome via `files.includes`).
  Load the `mastra` skill for current Mastra API questions instead of
  guessing from memory.

## Output

- Generated podcasts/transcripts go to `output/` (gitignored: `output/*.mp3`,
  `output/*.txt`). Committed samples live in `example/`. `keep/` is empty.
