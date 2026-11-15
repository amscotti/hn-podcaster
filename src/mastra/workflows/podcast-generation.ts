import { mkdir, rm } from "node:fs/promises";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  downloadContentStep,
  fetchStoriesMetadataStep,
  fetchTopStoriesStep,
  formatStoryContent,
  StoryWithTextSchema,
} from "../steps/index.ts";
import {
  createScriptEditorAgent,
  GLOBAL_SUGGESTION_CATEGORIES,
  type PerformanceEdit,
  performanceDirectorAgent,
  performanceEditsSchema,
  podcastAgent,
  type ScriptSuggestion,
  scriptSuggestionsSchema,
  suggestionAgent,
  summaryAgent,
  WINDOW_SUGGESTION_CATEGORIES,
} from "../agents/index.ts";
import { config } from "../../lib/config.ts";
import { getAppLogger } from "../../lib/logger.ts";
import {
  countDeliveryTags,
  countWords,
  findInvalidDeliveryTags,
  numberParagraphs,
  OPENAI_TTS_MAX_CHARS,
  ScriptEditState,
  segmentParagraphsForTts,
  splitParagraphs,
  validateEditedScript,
  validatePerformanceScript,
  XAI_TTS_MAX_CHARS,
} from "../../lib/script-editing.ts";
import {
  createVoiceProvider,
  getSpeechTagGuidance,
} from "../../lib/providers.ts";

const logger = getAppLogger("workflow");

/** Maximum parallel performance-director windows in flight. */
export const PERFORMANCE_WINDOW_CONCURRENCY = 4;

/**
 * Run `worker` over `items` with at most `concurrency` in flight,
 * preserving input order in the results. No new dependency.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const runners = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Calibrated from generated episodes: Eve at the configured 0.9 speed,
 * including delivery pauses, lands near 155 words per minute (vs ~175-180
 * at speed 1.0). Word budgets must use the measured rate or episodes run
 * short and rushed.
 */
const TARGET_WORDS_PER_MINUTE = 155;

/**
 * Step 4: Generate summaries for each story using AI
 */
const generateSummariesStep = createStep({
  id: "generate-summaries",
  inputSchema: z.object({
    storiesWithText: z.array(StoryWithTextSchema),
  }),
  outputSchema: z.object({
    summaries: z.array(z.string()),
    storiesWithText: z.array(StoryWithTextSchema),
  }),
  execute: async ({ inputData }) => {
    // Failed downloads are already dropped in download-content; this is a
    // safety net so empty bodies never produce placeholder summaries.
    const stories = inputData.storiesWithText.filter(
      (s) => s.text.trim().length > 0,
    );
    if (stories.length < inputData.storiesWithText.length) {
      logger.warn`Filtered ${
        inputData.storiesWithText.length - stories.length
      } empty-content stories before summarization`;
    }

    logger.info`Generating summaries for ${stories.length} stories`;

    const summaries = await Promise.all(
      stories.map(async (story, index) => {
        const communityContext = story.commentsText
          ? `\n\n## Hacker News Community Discussion\nTop comments from the Hacker News thread. These show how real practitioners and readers are reacting to this story - their opinions, pushback, personal experiences, counterarguments, and things they spotted that the article missed. Actively weave the most interesting community perspectives into your talking points: what did readers think? Did they agree or push back? Did someone share a relevant real-world experience or a sharp counterpoint? Call out representative views and name that they come from the discussion, e.g. "readers pointed out...", "commenters were skeptical because...". Don't just summarize the comments in bulk - integrate the standout voices and opinions as part of the story.\n${story.commentsText}`
          : "";

        const prompt = `Create a detailed summary of this page, summarizing the main ideas and creating talking points that would be relevant for someone who hasn't read the article.
For each talking point, please include why it is relevant to the story and details about why you would tell someone this.
Where the community discussion adds useful perspectives, differing opinions, or vivid examples, make those prominent talking points too - listeners love hearing how people are actually reacting.
Factual anchoring: use only facts present in the supplied article text and comments; never introduce a number, name, quote, date or claim that is not in them; when the source is thin or uncertain, say less instead of guessing.

## Story
${story.text}${communityContext}`;

        logger.debug`Summarizing story ${index + 1}: ${story.title}`;
        const result = await summaryAgent.generate(prompt);
        return formatStoryContent(story, result.text);
      }),
    );

    logger.info`Generated ${summaries.length} summaries`;
    return {
      summaries,
      storiesWithText: stories,
    };
  },
});

/**
 * Step 5: Generate initial podcast script
 */
const generateScriptStep = createStep({
  id: "generate-script",
  inputSchema: z.object({
    summaries: z.array(z.string()),
    storiesWithText: z.array(StoryWithTextSchema),
  }),
  outputSchema: z.object({
    script: z.string(),
    summaries: z.array(z.string()),
    iterationCount: z.number(),
  }),
  execute: async ({ inputData }) => {
    // download-content already throws on zero stories; this guard keeps the
    // step safe in isolation (a zero-length summaries array would divide by
    // zero below and produce a nonsense prompt).
    if (inputData.summaries.length === 0) {
      throw new Error("Cannot generate script: no story summaries available");
    }

    logger.info`Generating initial podcast script`;

    // Natural spoken date (e.g. "Friday, June 19th") - no time/timezone/year,
    // since reading a timestamp aloud sounds unnatural for a podcast intro.
    const spokenDate = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const ordinal = (n: number): string => {
      const s = ["th", "st", "nd", "rd"];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };
    const monthDay = spokenDate.replace(/(\d+)$/, (_, d) => ordinal(Number(d)));
    const date = monthDay;

    const tagGuidance = getSpeechTagGuidance();

    // Map configured duration to a concrete word budget using the voice's
    // measured delivery rate (see TARGET_WORDS_PER_MINUTE).
    const targetWords = config.targetDurationMinutes * TARGET_WORDS_PER_MINUTE;
    const perStoryWords = Math.round(targetWords / inputData.summaries.length);

    const prompt = `You're writing the script for "Hacker Insight," a tech podcast. Today is ${date}.

Your job is to turn these story summaries into a conversational, engaging monologue that sounds like a real person talking to curious listeners.

Factual anchoring: use only facts present in the supplied story summaries; never introduce a number, name, quote, date or claim that is not in them; when the source is thin or uncertain, say less instead of guessing.

IMPORTANT: You must cover ALL ${inputData.summaries.length} stories provided below. Don't skip any.

LENGTH TARGET (very important): Aim for roughly ${targetWords} words total - about ${config.targetDurationMinutes} minutes spoken. With ${inputData.summaries.length} stories, that's around ${perStoryWords} words per story on average (plus intro/outro), but do NOT force equal depth. Stay reasonably close to this target. If you must choose, leave out a secondary detail rather than compressing every sentence or padding with filler; room to react and breathe matters more than exhaustive coverage.

Guidelines:
- Open with a warm, friendly greeting ("Hey everyone, welcome to Hacker Insight...") and mention the date casually, the way a real host would ("It's Friday, June 19th" - never read a timestamp or year). Then a SHORT, high-level TEASE of what's coming - hint at the broad themes, common threads, or a couple of standout hooks to pull listeners in, like a movie trailer. Do NOT list every story or give a rundown - just build intrigue for what's ahead. Then dive into the first story.
- Cover EVERY story, but vary the depth like a real episode: pick the 2-3 strongest stories as anchors and give them 3-4 paragraphs to breathe; treat the rest crisply in 1-2 paragraphs. A weaker story told well in one vivid paragraph beats padding it to match the anchors.
- When technical terms come up, explain them simply (e.g., "eBPF - that's a way to run tiny programs inside the Linux kernel to watch what's happening")
- Use conversational language - contractions, rhetorical questions, direct address ("you"). Short fragments are fine for emphasis when a real speaker would use them.
- TALK, DON'T REPORT (very important): this must sound like a host speaking, not an article being read aloud. Be a present, opinionated host: react to each striking fact ("honestly, that number stopped me cold"), crack the occasional dry aside, ask the listener questions. NEVER deliver three bare facts in a row with nothing human between them. Bad: "It boots into sofa mode. It unlocks hidden cores. Miss the memory step and the board dies." Good: "It boots straight into sofa mode - like a PlayStation that costs less than lunch. Well... sort of. Because to get there you have to rewrite the board's startup software, and if you get the memory split wrong? You've got a very cheap brick." Every story needs host presence - first-person reaction, a question, or an aside - not just facts.
- COHESION (very important): this is ONE continuous spoken monologue, not ten mini-segments glued together. Thread ideas through the episode: echo earlier stories later ("remember...?", "same trick as..."), let the intro's tease pay off in the body, and make the outro feel earned by what came before. If you ask the listener a question, do NOT move on until you've answered or explored it - a question followed by a topic change sounds broken. Each paragraph should follow from the previous one; if a paragraph could be shuffled anywhere without anyone noticing, rewrite it so it belongs exactly where it is.
- Where the summaries mention what Hacker News readers or commenters thought, weave those reactions in naturally - it adds a lot to occasionally reflect how practitioners are responding, where they agreed or pushed back, or a sharp comment someone made. Don't force it every story, but use the best ones.
- IMPORTANT: Bridge smoothly from one story to the next - never jump abruptly into a new topic. Each transition should connect the two stories with a brief link: a shared theme, a contrast, a question, or a one-line reaction to what came before. Vary them and make them feel like a real host connecting the dots (e.g., "Speaking of things that sound too good to be true...", "That's the optimistic view - now for the flip side.", "On a much lighter note..."). Avoid blunt cuts like a generic "Switching gears..." followed immediately by the new topic.
- IMPORTANT: End by stepping back to reflect on the episode as a whole - the range of topics explored, any common threads or patterns linking the stories, or a broader lesson or takeaway that ties them together. Think big picture, NOT a list of each story (the listener just heard them). Then a brief warm sign-off thanking listeners and inviting them back. Don't mention subscribing, comments, likes, or any platform-specific calls to action.
${tagGuidance}
What to avoid:
- Skipping or combining stories - every story gets its own section
- Dense sentences packing too many facts into one breath
- Unexplained jargon or acronyms
- Reading code, SQL, or technical syntax aloud - describe what it does instead

Here are all ${inputData.summaries.length} stories to cover:

${inputData.summaries.join("\n\n")}

Write the complete script covering ALL stories as flowing paragraphs.`;

    const result = await podcastAgent.generate(prompt);

    logger.info`Initial script generated (${result.text.length} characters)`;
    return {
      script: result.text,
      summaries: inputData.summaries,
      iterationCount: 0,
    };
  },
});

/** Paragraphs reviewed per windowed suggestion pass. */
const SUGGESTION_WINDOW_SIZE = 8;

/** Hard cap on suggestions handed to the editor agent per iteration. */
const MAX_SUGGESTIONS_PER_ITERATION = 30;

/** Extract story titles from formatted summaries ("## Title" first line). */
function extractStoryTitles(summaries: string[]): string[] {
  return summaries.map((summary, i) => {
    const match = summary.match(/^##\s+(.+)$/m);
    return match ? match[1].trim() : `Story ${i + 1}`;
  });
}

/** Render paragraphs [startId..endId] (1-based, inclusive) with [Pn] markers. */
function numberParagraphRange(
  paragraphs: string[],
  startId: number,
  endId: number,
): string {
  return paragraphs
    .slice(startId - 1, endId)
    .map((p, j) => `[P${startId + j}] ${p}`)
    .join("\n\n");
}

/**
 * Ensure a suggestion carries usable paragraph anchors: drop ids that are
 * out of range, and when none survive, locate the quoted text.
 */
function anchorSuggestion(
  suggestion: ScriptSuggestion,
  paragraphs: string[],
): ScriptSuggestion {
  const valid = suggestion.paragraphIds.filter(
    (id) => id >= 1 && id <= paragraphs.length,
  );
  if (valid.length > 0) return { ...suggestion, paragraphIds: valid };
  if (suggestion.quote) {
    const needle = suggestion.quote.trim().slice(0, 60);
    const index = paragraphs.findIndex(
      (p) => needle.length > 0 && p.includes(needle),
    );
    if (index >= 0) return { ...suggestion, paragraphIds: [index + 1] };
  }
  return { ...suggestion, paragraphIds: [] };
}

/**
 * Suggestions that need no LLM: length drift, delivery tags the TTS would
 * read aloud literally, and platform CTAs in the outro. Cheap, exact, and
 * they keep the slowest checks out of the reasoning model's queue.
 */
function deterministicSuggestions(
  state: ScriptEditState,
  targetWords: number,
): ScriptSuggestion[] {
  const out: ScriptSuggestion[] = [];
  const currentWords = state.totalWords();

  if (Math.abs(currentWords - targetWords) / targetWords > 0.15) {
    out.push({
      category: "length",
      paragraphIds: [],
      fix:
        currentWords < targetWords
          ? `Script is ${currentWords} words vs ~${targetWords} target. Expand the thinnest story sections with substance from the summaries (examples, explanation, community reactions), never filler.`
          : `Script is ${currentWords} words vs ~${targetWords} target. Trim repetition and tangents, tightest first; keep every story covered.`,
    });
  }

  const xaiTagsAllowed = config.voiceProvider === "xai";
  state.paragraphs.forEach((paragraph, i) => {
    const invalid = findInvalidDeliveryTags(paragraph, xaiTagsAllowed);
    if (invalid.length > 0) {
      out.push({
        category: "delivery",
        paragraphIds: [i + 1],
        quote: invalid.join(" "),
        fix: `Remove or replace these delivery tags, which the voice would read aloud literally: ${invalid.join(", ")}. Use only tags from the delivery guidance in the editor prompt.`,
      });
    }
  });

  const ctaPattern =
    /\b(subscribe|like and subscribe|smash the like|comment below|comments below|hit the bell|follow us on)\b/i;
  const outroStart = Math.max(0, state.paragraphCount - 2);
  state.paragraphs.slice(outroStart).forEach((paragraph, j) => {
    if (ctaPattern.test(paragraph)) {
      out.push({
        category: "platform-language",
        paragraphIds: [outroStart + j + 1],
        fix: "Remove the platform-specific call to action (subscribe/like/comment language) from the outro. End with reflection and a warm sign-off instead.",
      });
    }
  });

  return out;
}

/** One structured suggestion call, failure-isolated to an empty result. */
async function runSuggestionPrompt(
  prompt: string,
  label: string,
): Promise<ScriptSuggestion[]> {
  try {
    const result = await suggestionAgent.generate(prompt, {
      structuredOutput: { schema: scriptSuggestionsSchema },
    });
    // Mastra types zod .default() fields as optional on the result
    // object; normalize so downstream code sees the schema output type.
    return (result.object?.suggestions ?? []).map((s) => ({
      ...s,
      paragraphIds: s.paragraphIds ?? [],
    }));
  } catch (error) {
    logger.warn`Suggestion pass failed (${label}): ${error}`;
    return [];
  }
}

/**
 * Collect improvement suggestions without any single mega-call: exact
 * deterministic checks, per-window local reviews in parallel, and one
 * small whole-episode review over previews. This keeps every LLM call
 * small enough for a slow reasoning model to finish comfortably.
 */
async function collectSuggestions(
  state: ScriptEditState,
  summaries: string[],
  targetWords: number,
): Promise<ScriptSuggestion[]> {
  const paragraphs = state.paragraphs;
  const total = paragraphs.length;
  const tagGuidance = getSpeechTagGuidance();
  // Windows judge delivery locally, which tends to pile tags on; give each
  // window the episode-wide density so additions stay exceptional.
  const pauseCount = paragraphs.reduce(
    (sum, p) => sum + (p.match(/\[(long-)?pause\]|\[laugh\]/g)?.length ?? 0),
    0,
  );
  const deliveryNote = tagGuidance
    ? `\nDelivery tags: the full script already has ${pauseCount} pause/laugh tags across ${total} paragraphs. Suggest adding one ONLY where a beat or energy shift is truly missing; do suggest removal where a paragraph is tag-heavy. Prefer punctuation and sentence rhythm over tags.\n`
    : "";

  const windowCategories = new Set<string>(WINDOW_SUGGESTION_CATEGORIES);
  const windowPromises: Array<Promise<ScriptSuggestion[]>> = [];
  for (let start = 1; start <= total; start += SUGGESTION_WINDOW_SIZE) {
    const end = Math.min(total, start + SUGGESTION_WINDOW_SIZE - 1);
    const contextNote =
      start > 1
        ? `\nPreceding paragraph (context only, do not flag it):\n[P${start - 1}] ${paragraphs[start - 2]}\n`
        : "";
    const prompt = `You are reviewing ONLY paragraphs P${start}-P${end} of a ${total}-paragraph podcast script. Judge only these paragraphs. Use ONLY these categories: ${WINDOW_SUGGESTION_CATEGORIES.join(", ")}. Do NOT flag missing stories, overall length, intro, or outro.
${contextNote}
Paragraphs under review:
${numberParagraphRange(paragraphs, start, end)}
${deliveryNote}`;
    windowPromises.push(
      runSuggestionPrompt(prompt, `window P${start}-P${end}`).then((list) =>
        list
          .filter((s) => windowCategories.has(s.category))
          .map((s) => anchorSuggestion(s, paragraphs)),
      ),
    );
  }

  const titles = extractStoryTitles(summaries);
  const overview = paragraphs
    .map((p, i) => {
      const preview = p.length > 110 ? `${p.slice(0, 110)}...` : p;
      return `[P${i + 1}] (${countWords(p)} words) ${preview}`;
    })
    .join("\n");
  const globalPrompt = `You are reviewing a complete ${total}-paragraph, ${state.totalWords()}-word podcast script at the whole-episode level only. Use ONLY these categories: ${GLOBAL_SUGGESTION_CATEGORIES.join(", ")}.

Stories that MUST all be covered, in order:
${titles.map((title, i) => `${i + 1}. ${title}`).join("\n")}

Paragraph overview (previews with word counts - judge coverage, depth balance, and episode flow from this):
${overview}

Intro (full text):
${numberParagraphRange(paragraphs, 1, Math.min(2, total))}

Outro (full text):
${numberParagraphRange(paragraphs, Math.max(1, total - 1), total)}`;
  const globalCategories = new Set<string>(GLOBAL_SUGGESTION_CATEGORIES);
  const globalPromise = runSuggestionPrompt(globalPrompt, "global").then(
    (list) =>
      list
        .filter((s) => globalCategories.has(s.category))
        .map((s) => anchorSuggestion(s, paragraphs)),
  );

  const [windowResults, globalResults] = await Promise.all([
    Promise.all(windowPromises),
    globalPromise,
  ]);

  const merged = [
    ...deterministicSuggestions(state, targetWords),
    ...globalResults,
    ...windowResults.flat(),
  ];
  return merged.slice(0, MAX_SUGGESTIONS_PER_ITERATION);
}

/**
 * Step 6: Improve script (single iteration, agentic paragraph-level edits)
 */
const improveScriptOnceStep = createStep({
  id: "improve-script-once",
  inputSchema: z.object({
    script: z.string(),
    summaries: z.array(z.string()),
    iterationCount: z.number(),
    shouldContinue: z.boolean().default(true),
  }),
  outputSchema: z.object({
    script: z.string(),
    summaries: z.array(z.string()),
    iterationCount: z.number(),
    shouldContinue: z.boolean(),
  }),
  execute: async ({ inputData }) => {
    // Skip when iterations is 0, or if we already hit the configured cap
    // (covers do-while always running the step once before the condition).
    if (inputData.iterationCount >= config.improvementIterations) {
      logger.info`Skipping script improvement (IMPROVEMENT_ITERATIONS=${config.improvementIterations})`;
      return {
        script: inputData.script,
        summaries: inputData.summaries,
        iterationCount: inputData.iterationCount,
        shouldContinue: false,
      };
    }

    const iteration = inputData.iterationCount + 1;
    logger.info`Improving script (iteration ${iteration}/${config.improvementIterations})`;

    const targetWords = config.targetDurationMinutes * TARGET_WORDS_PER_MINUTE;
    const state = new ScriptEditState(inputData.script);
    const wordsBefore = state.totalWords();

    // Stage 1: collect anchored suggestions (deterministic + windowed +
    // global reviews). No single call sees the whole episode in full, so
    // a slow reasoning model finishes each one comfortably.
    logger.debug`Collecting improvement suggestions`;
    const suggestions = await collectSuggestions(
      state,
      inputData.summaries,
      targetWords,
    );

    if (suggestions.length === 0) {
      logger.info`No improvements needed - script is ready`;
      return {
        script: inputData.script,
        summaries: inputData.summaries,
        iterationCount: iteration,
        shouldContinue: false,
      };
    }

    logger.info`Found ${suggestions.length} suggestions to apply`;

    // Stage 2: a tool-using editor agent applies the suggestions as
    // surgical paragraph edits. Untouched paragraphs stay byte-identical,
    // and each model turn only emits a small tool call.
    const titles = extractStoryTitles(inputData.summaries);
    const suggestionsText = suggestions
      .map((s, i) => {
        const targets =
          s.paragraphIds.length > 0
            ? ` paragraphs ${s.paragraphIds.map((id) => `P${id}`).join(", ")}`
            : " (whole episode)";
        const quote = s.quote ? `\n  Quote: "${s.quote}"` : "";
        return `${i + 1}. [${s.category}]${targets}${quote}\n  Fix: ${s.fix}`;
      })
      .join("\n");
    const tagGuidance = getSpeechTagGuidance();
    const editorPrompt = `Apply these editor suggestions to the podcast script using your paragraph tools. Work through them in order, make the smallest edit that fixes each one, and do not rewrite paragraphs no suggestion targets.

LENGTH: Current script is ${wordsBefore} words; target is ~${targetWords} words (~${config.targetDurationMinutes} minutes spoken).

Stories in this episode (use read_story_summary with a 1-based index when a fix needs facts):
${titles.map((title, i) => `${i + 1}. ${title}`).join("\n")}

Current script (${state.paragraphCount} paragraphs):
${numberParagraphs(state.paragraphs)}

Editor's suggestions:
${suggestionsText}
${tagGuidance}
When every suggestion is applied, re-read the neighborhoods around your edits once to fix broken transitions, then reply with a one or two sentence summary.`;

    const editor = createScriptEditorAgent(state, inputData.summaries);
    const maxSteps = Math.min(12 + suggestions.length * 2, 48);
    let editorFailed = false;
    try {
      logger.debug`Editor agent applying edits (maxSteps=${maxSteps})`;
      const editorResult = await editor.generate(editorPrompt, { maxSteps });
      logger.debug`Editor summary: ${editorResult.text.slice(0, 300)}`;
    } catch (error) {
      // Improvement is an enhancement, not a gate: partial validated
      // edits still ship, and the loop stops instead of retrying a
      // failing iteration.
      editorFailed = true;
      logger.warn`Editor agent failed in iteration ${iteration}: ${error}`;
    }

    if (state.edits.length === 0) {
      logger.warn`Editor made no edits in iteration ${iteration}; keeping script and stopping improvement loop`;
      return {
        script: inputData.script,
        summaries: inputData.summaries,
        iterationCount: iteration,
        shouldContinue: false,
      };
    }

    const validation = validateEditedScript(inputData.script, state.paragraphs);
    if (!validation.valid) {
      logger.warn`Edited script failed validation (${validation.issues.join("; ")}); keeping previous script`;
      return {
        script: inputData.script,
        summaries: inputData.summaries,
        iterationCount: iteration,
        shouldContinue: false,
      };
    }

    logger.info`Script improved (iteration ${iteration} complete): ${state.edits.length} edits, ${wordsBefore} -> ${state.totalWords()} words`;
    return {
      script: state.getScript(),
      summaries: inputData.summaries,
      iterationCount: iteration,
      shouldContinue: !editorFailed,
    };
  },
});

/**
 * Step 7: Direct the vocal performance.
 *
 * A separate structured patch pass concerned only with how the script sounds:
 * emotional arc, sentence rhythm, pause hierarchy, punctuation, and a
 * restrained delivery-tag budget. It cannot change facts or story order,
 * and its output must pass length/tag validation before acceptance; on
 * any failure the unimproved-performance script proceeds to audio.
 */
const directPerformanceStep = createStep({
  id: "direct-performance",
  inputSchema: z.object({
    script: z.string(),
    summaries: z.array(z.string()),
    iterationCount: z.number(),
    shouldContinue: z.boolean().optional(),
  }),
  outputSchema: z.object({
    script: z.string(),
    summaries: z.array(z.string()),
    iterationCount: z.number(),
  }),
  execute: async ({ inputData }) => {
    if (inputData.script.trim().length === 0) {
      return {
        script: inputData.script,
        summaries: inputData.summaries,
        iterationCount: inputData.iterationCount,
      };
    }

    logger.info`Directing voice performance`;
    const state = new ScriptEditState(inputData.script);
    const wordsBefore = state.totalWords();
    const tagsBefore = countDeliveryTags(inputData.script);
    const titles = extractStoryTitles(inputData.summaries);
    const tagGuidance = getSpeechTagGuidance();

    // Bounded patch calls per 4-paragraph window, run in parallel. Each
    // call returns at most a couple of single-paragraph replacements,
    // applied here in code. A free-roaming tool director on grok-4.7
    // measured 85-130s per step and over-edited; this shape cannot.
    const PERFORMANCE_WINDOW_SIZE = 4;
    const MAX_PERFORMANCE_EDITS = 14;
    const paragraphs = state.paragraphs;
    const storyList = titles.map((title, i) => `${i + 1}. ${title}`).join("\n");

    const runWindow = async (
      start: number,
      end: number,
    ): Promise<PerformanceEdit[]> => {
      const contextBefore =
        start > 1
          ? `\nPreceding paragraph (context only):\n[P${start - 1}] ${paragraphs[start - 2]}\n`
          : "";
      const contextAfter =
        end < paragraphs.length
          ? `\nFollowing paragraph (context only):\n[P${end + 1}] ${paragraphs[end]}\n`
          : "";
      const prompt = `Direct the vocal performance of ONLY paragraphs P${start}-P${end} of a ${paragraphs.length}-paragraph podcast script. Change how they sound, not what they say. Return at most 2 structured replacements, each for exactly one paragraph in this window, and none if the window already sounds alive.

Stories in this episode (order only; do not add facts):
${storyList}
${contextBefore}
Paragraphs to direct:
${numberParagraphRange(paragraphs, start, end)}
${contextAfter}
The full script currently has ${tagsBefore} delivery tags. Keep this window's total word count close to the original.
${tagGuidance}`;
      try {
        const result = await performanceDirectorAgent.generate(prompt, {
          structuredOutput: { schema: performanceEditsSchema },
          modelSettings: {
            timeout: { totalMs: 240_000, stepMs: 240_000 },
          },
        });
        return (result.object?.edits ?? [])
          .filter((e) => e.paragraphId >= start && e.paragraphId <= end)
          .slice(0, 2);
      } catch (error) {
        logger.warn`Performance window P${start}-P${end} failed: ${error}`;
        return [];
      }
    };

    const windowRanges: Array<{ start: number; end: number }> = [];
    for (
      let start = 1;
      start <= paragraphs.length;
      start += PERFORMANCE_WINDOW_SIZE
    ) {
      const end = Math.min(
        paragraphs.length,
        start + PERFORMANCE_WINDOW_SIZE - 1,
      );
      windowRanges.push({ start, end });
    }
    const windowResults = await mapWithConcurrency(
      windowRanges,
      PERFORMANCE_WINDOW_CONCURRENCY,
      (range) => runWindow(range.start, range.end),
    );
    const candidates = windowResults.flat();

    // Dedupe by paragraph, cap the pass, sanity-filter each replacement,
    // then apply in descending id order so a multi-paragraph replacement
    // can never shift the ids of edits still to apply (replacements are
    // single-paragraph by instruction, but stay defensive).
    const seen = new Set<number>();
    const applicable: PerformanceEdit[] = [];
    for (const edit of candidates) {
      if (seen.has(edit.paragraphId)) continue;
      seen.add(edit.paragraphId);
      const original = paragraphs[edit.paragraphId - 1];
      if (original === undefined) continue;
      if (splitParagraphs(edit.text).length !== 1) continue;
      if (
        findInvalidDeliveryTags(edit.text, config.voiceProvider === "xai")
          .length > 0
      ) {
        continue;
      }
      const ratio = countWords(edit.text) / Math.max(1, countWords(original));
      if (ratio < 0.65 || ratio > 1.5) continue;
      applicable.push(edit);
      if (applicable.length >= MAX_PERFORMANCE_EDITS) break;
    }
    applicable.sort((a, b) => b.paragraphId - a.paragraphId);
    for (const edit of applicable) {
      const applied = state.replace(edit.paragraphId, edit.text);
      if (applied.ok) {
        logger.debug`Performance edit P${edit.paragraphId}: ${edit.reason}`;
      }
    }

    if (state.edits.length === 0) {
      logger.info`Performance pass made no edits; keeping script`;
      return {
        script: inputData.script,
        summaries: inputData.summaries,
        iterationCount: inputData.iterationCount,
      };
    }

    const validation = validatePerformanceScript(
      inputData.script,
      state.paragraphs,
      config.voiceProvider === "xai",
    );
    if (!validation.valid) {
      logger.warn`Performance edits failed validation (${validation.issues.join("; ")}); keeping previous script`;
      return {
        script: inputData.script,
        summaries: inputData.summaries,
        iterationCount: inputData.iterationCount,
      };
    }

    const directedScript = state.getScript();
    logger.info`Performance directed: ${state.edits.length} edits, ${wordsBefore} -> ${state.totalWords()} words, ${tagsBefore} -> ${countDeliveryTags(directedScript)} delivery tags`;
    return {
      script: directedScript,
      summaries: inputData.summaries,
      iterationCount: inputData.iterationCount,
    };
  },
});

/** Build audio segments from a script, failing on an empty script. */
export function buildAudioSegments(
  script: string,
  voiceProvider: string,
): string[] {
  const paragraphs = splitParagraphs(script);
  if (paragraphs.length === 0) {
    throw new Error("Cannot generate audio: script is empty (no paragraphs)");
  }
  const ttsMaxChars =
    voiceProvider === "openai" ? OPENAI_TTS_MAX_CHARS : XAI_TTS_MAX_CHARS;
  const rawSegments = segmentParagraphsForTts(paragraphs, {
    maxChars: ttsMaxChars,
  });
  if (rawSegments.length === 0) {
    throw new Error("Cannot generate audio: script produced no segments");
  }
  return rawSegments.map((segment, i) =>
    i > 0 && voiceProvider === "xai" && !segment.startsWith("[long-pause]")
      ? `[long-pause] ${segment}`
      : segment,
  );
}

/**
 * Step 8: Generate audio from script using TTS
 */
export const generateAudioStep = createStep({
  id: "generate-audio",
  inputSchema: z.object({
    script: z.string(),
    summaries: z.array(z.string()),
    iterationCount: z.number(),
  }),
  outputSchema: z.object({
    transcriptPath: z.string(),
    audioPath: z.string(),
    generatedAt: z.string(),
  }),
  execute: async ({ inputData }) => {
    logger.info`Generating audio from script`;

    // Fail fast on an empty script so no empty transcript/MP3 is written
    // and reported as success.
    const scriptParagraphs = splitParagraphs(inputData.script);
    if (scriptParagraphs.length === 0) {
      throw new Error("Cannot generate audio: script is empty (no paragraphs)");
    }

    const outputDir = config.outputDir;

    // Ensure output directory exists (recursive mkdir is a no-op if present)
    await mkdir(outputDir, { recursive: true });

    // Generate timestamp with date and time for unique filenames (YYYY-MM-DD_HH-MM-SS)
    const timestamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace("T", "_")
      .replaceAll(":", "-");
    const transcriptPath = `${outputDir}/${timestamp}_podcast.txt`;
    const audioPath = `${outputDir}/${timestamp}_podcast.mp3`;

    // Write transcript
    await Bun.write(transcriptPath, inputData.script);
    logger.info`Transcript saved to ${transcriptPath}`;

    // Skip audio generation if configured
    if (config.skipAudio) {
      logger.info`Skipping audio generation (SKIP_AUDIO=true)`;
      return {
        transcriptPath,
        audioPath: "",
        generatedAt: new Date().toISOString(),
      };
    }

    // Initialize the configured voice provider (OpenAI or xAI/Grok)
    const { voice, speakOptions } = createVoiceProvider();
    logger.info`Using ${config.voiceProvider} voice provider for TTS`;

    // Synthesize story-sized segments (several complete paragraphs per
    // request) rather than one request per paragraph. This lets the voice
    // carry intonation across transitions instead of resetting prosody at
    // every paragraph. Later segments get a synthesized long pause at
    // their head so segment joins read as real chapter breaths.
    const textChunks = buildAudioSegments(
      inputData.script,
      config.voiceProvider,
    );
    if (textChunks.length === 0) {
      throw new Error("Cannot generate audio: script produced no segments");
    }

    logger.info`Generating audio for ${textChunks.length} TTS segments (${scriptParagraphs.length} paragraphs)`;

    // Stream each segment's MP3 bytes straight into the final file with a
    // single Bun FileSink. MP3 frames concatenate cleanly, so appending
    // segment audio in order is equivalent to the old part-file concat
    // without temp files. On failure the partial file is removed so a
    // truncated episode never masquerades as a finished one.
    const writer = Bun.file(audioPath).writer();
    try {
      for (let i = 0; i < textChunks.length; i++) {
        const chunk = textChunks[i];

        logger.debug`Generating audio segment ${i + 1}/${textChunks.length}`;
        const audioStream = await voice.speak(chunk, speakOptions);
        if (!audioStream) {
          throw new Error(
            `Voice provider returned no audio stream for segment ${i + 1}`,
          );
        }

        // Collect audio data from the byte stream using async iteration
        const audioChunks: Uint8Array[] = [];
        for await (const data of audioStream) {
          // Handle both Buffer and Uint8Array from Node.js / web streams
          if (data instanceof Uint8Array) {
            audioChunks.push(data);
          } else if (typeof data === "object" && data !== null) {
            audioChunks.push(new Uint8Array(data as ArrayBuffer));
          }
        }
        const totalLength = audioChunks.reduce(
          (acc, arr) => acc + arr.length,
          0,
        );
        const buffer = new Uint8Array(totalLength);
        let offset = 0;
        for (const arr of audioChunks) {
          buffer.set(arr, offset);
          offset += arr.length;
        }

        writer.write(buffer);
      }
      await writer.end();
    } catch (error) {
      try {
        await writer.end();
      } catch {
        // Already handling the original error; sink may already be closed.
      }
      await rm(audioPath, { force: true }).catch(() => {});
      throw error;
    }

    logger.info`Audio saved to ${audioPath}`;
    return {
      transcriptPath,
      audioPath,
      generatedAt: new Date().toISOString(),
    };
  },
});

/**
 * Main podcast generation workflow
 */
const workflowInputSchema = z.object({
  storyCount: z.number().default(7),
});
const workflowOutputSchema = z.object({
  transcriptPath: z.string(),
  audioPath: z.string(),
  generatedAt: z.string(),
});

export const podcastWorkflow = createWorkflow({
  id: "podcast-generation",
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
  .then(fetchTopStoriesStep)
  .then(fetchStoriesMetadataStep)
  .then(downloadContentStep)
  .then(generateSummariesStep)
  .then(generateScriptStep)
  // Run improvement loop (exits early if no improvements needed)
  .dowhile(
    improveScriptOnceStep,
    async ({ inputData }) =>
      inputData.shouldContinue &&
      inputData.iterationCount < config.improvementIterations,
  )
  .then(directPerformanceStep)
  .then(generateAudioStep)
  .commit();

export type PodcastWorkflowInput = z.infer<typeof workflowInputSchema>;
export type PodcastWorkflowOutput = z.infer<typeof workflowOutputSchema>;
