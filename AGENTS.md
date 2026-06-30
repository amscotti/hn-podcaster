# AGENTS.md

Guidance for OpenCode sessions working in this repo. Only non-obvious,
repo-specific facts are included.

## Toolchain

- **Deno project, not Node.** There is no `package.json`; dependencies are
  `jsr:` / `npm:` specifiers mapped in `deno.json`. Pin is Deno 2.8.3
  (`mise.toml`); run `mise install` or use any Deno 2.8+.
- `deno.json` grants broad `net`/`write`/`read`/`env` permissions, so no
  `--allow-*` flag juggling is needed when running.

## Commands

```bash
deno task start   # run the podcast pipeline; auto-loads .env (--env-file)
deno task check   # deno check app.ts && deno lint && deno fmt --check
deno task test    # deno test
```

- **Verify with `deno task check` before considering work done.** It only
  typechecks the `app.ts` entry, but that transitively pulls in all imports.
- **There is no CI for tests or lint.** The only GitHub workflow
  (`.github/workflows/opencode-review.yml`) runs an OpenCode PR review. The
  local `check` + `test` tasks are the real gate.
- Run a single test with `deno test --filter "fetchTopStories"` or pass a path:
  `deno test src/__tests__/hackernews.test.ts`.
- Tests stub `globalThis.fetch` by hand; `@std/testing/mock` is imported but not
  used in the existing suite.

## Runtime gotchas

- **A valid `.env` is required to run `app.ts`** (or anything importing
  `src/lib/config.ts`). `config.ts` loads and validates at module initialization
  and throws immediately if no AI provider API key is present. The existing test
  file deliberately imports only `lib/hackernews.ts`, so `deno task test` runs
  without `.env` — but any new test that imports config/providers will need one.
- **The README is stale re: voice provider.** It says OpenAI TTS is the default;
  the code defaults to **xAI** (`src/lib/config.ts`). Trust the code, not the
  README, on defaults. `VOICE_PROVIDER=openai` or `SKIP_AUDIO=true` override it.
- `app.ts` ends with an explicit `Deno.exit(0)` because Mastra's streaming
  machinery and the AI HTTP clients keep the event loop alive. Do not remove it.

## Don't "fix" these on instinct

- **Structural `VoiceLike` interface in `src/lib/providers.ts`.** It is
  intentional: `@mastra/voice-openai` bundles its own copy of `@mastra/core`, so
  typing against `MastraVoice` directly is structurally incompatible. Leave it.
- The OpenAI voice model is cast through `as any` for the same reason — the
  shipped types only list `tts-1`/`tts-1-hd`, but `gpt-4o-mini-tts` works.

## Architecture pointers

- Workflow lives in `src/mastra/workflows/podcast-generation.ts` and is the
  spine of the app: fetch stories → metadata → download content → summarize →
  script → improve loop (`dowhile`) → TTS audio. `app.ts` just streams it.
- Adding/changing an AI provider touches **two** files: the model table in
  `src/lib/providers.ts` and the provider id list + env-key map in
  `src/lib/config.ts`.
- `@mastra/core` is pinned to `1.43.0` and `@mastra/voice-openai` to `0.12.2`
  (exact versions in `deno.json`). Bump deliberately.

## Mastra help

- A local Mastra skill ships at `.agents/skills/mastra/` (and is excluded from
  Deno's compile config via `deno.json` `exclude`). Load the `mastra` skill for
  current Mastra API questions instead of guessing from memory.

## Output

- Generated podcasts/transcripts go to `output/` (gitignored: `output/*.mp3`,
  `output/*.txt`). Committed samples live in `example/`. `keep/` is empty.
