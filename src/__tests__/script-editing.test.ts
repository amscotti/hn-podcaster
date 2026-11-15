import { expect, test } from "bun:test";
import {
  countDeliveryTags,
  countWords,
  findInvalidDeliveryTags,
  joinParagraphs,
  MAX_TAGS_PER_PARAGRAPH,
  numberParagraphs,
  OPENAI_TTS_MAX_CHARS,
  ScriptEditState,
  segmentParagraphsForTts,
  splitParagraphs,
  validateEditedScript,
  validatePerformanceScript,
  XAI_TTS_MAX_CHARS,
} from "../lib/script-editing.ts";

test("split/join round-trips a script", () => {
  const script = "Para one here.\n\nPara two here.\n\n\nPara three.";
  const paragraphs = splitParagraphs(script);
  expect(paragraphs).toEqual([
    "Para one here.",
    "Para two here.",
    "Para three.",
  ]);
  expect(joinParagraphs(paragraphs)).toBe(
    "Para one here.\n\nPara two here.\n\nPara three.",
  );
});

test("numberParagraphs adds 1-based markers", () => {
  expect(numberParagraphs(["a", "b"])).toBe("[P1] a\n\n[P2] b");
});

test("ScriptEditState replace swaps one paragraph and logs the edit", () => {
  const state = new ScriptEditState("First para.\n\nSecond para here.");
  const result = state.replace(2, "Replaced second.");
  expect(result.ok).toBe(true);
  expect(state.getScript()).toBe("First para.\n\nReplaced second.");
  expect(state.edits.length).toBe(1);
  expect(state.edits[0].op).toBe("replace");
  expect(state.edits[0].paragraphId).toBe(2);
});

test("ScriptEditState replace supports multi-paragraph replacement", () => {
  const state = new ScriptEditState("Only para.");
  const result = state.replace(1, "New first.\n\nNew second.");
  expect(result.ok).toBe(true);
  expect(state.paragraphCount).toBe(2);
  expect(state.getScript()).toBe("New first.\n\nNew second.");
});

test("ScriptEditState strips echoed [Pn] markers from agent text", () => {
  const state = new ScriptEditState("First.\n\nSecond.");
  state.replace(1, "[P1] Echoed replacement.");
  expect(state.paragraphs[0]).toBe("Echoed replacement.");
});

test("ScriptEditState insertAfter handles start, middle, and end", () => {
  const state = new ScriptEditState("Middle.");
  expect(state.insertAfter(0, "Start.").ok).toBe(true);
  expect(state.insertAfter(2, "End.").ok).toBe(true);
  expect(state.getScript()).toBe("Start.\n\nMiddle.\n\nEnd.");
  expect(state.insertAfter(9, "Nope.").ok).toBe(false);
});

test("ScriptEditState delete removes a paragraph but never the last one", () => {
  const state = new ScriptEditState("One.\n\nTwo.");
  expect(state.delete(1).ok).toBe(true);
  expect(state.getScript()).toBe("Two.");
  const refused = state.delete(1);
  expect(refused.ok).toBe(false);
  expect(state.paragraphCount).toBe(1);
});

test("ScriptEditState rejects invalid ids and empty text", () => {
  const state = new ScriptEditState("Only.");
  expect(state.replace(2, "x").ok).toBe(false);
  expect(state.replace(1, "   ").ok).toBe(false);
  expect(state.delete(0).ok).toBe(false);
  expect(state.edits.length).toBe(0);
});

test("ScriptEditState read returns requested paragraphs with word counts", () => {
  const state = new ScriptEditState("One two.\n\nThree four five.");
  const read = state.read([2, 99, 1]);
  expect(read.length).toBe(2);
  expect(read[0]).toEqual({ id: 2, text: "Three four five.", words: 3 });
  expect(read[1].id).toBe(1);
});

test("validateEditedScript accepts a sane edit and rejects gutted output", () => {
  const original =
    "alpha beta gamma delta epsilon zeta eta theta.\n\nSecond para stays.";
  const sane = validateEditedScript(original, [
    "alpha beta gamma delta epsilon zeta eta theta iota.",
    "Second para stays.",
  ]);
  expect(sane.valid).toBe(true);

  const gutted = validateEditedScript(original, ["tiny."]);
  expect(gutted.valid).toBe(false);
});

test("validateEditedScript catches leaked markers and markdown headings", () => {
  const original = "Some opening words here for length.";
  const leaked = validateEditedScript(original, [
    "[P1] Some opening words here for length.",
  ]);
  expect(leaked.valid).toBe(false);

  const headed = validateEditedScript(original, [
    "# Title\nSome opening words here for length.",
  ]);
  expect(headed.valid).toBe(false);
});

test("findInvalidDeliveryTags flags unknown tags only", () => {
  const text =
    "Wait [pause] for it [sigh] and <whisper>this</whisper> <shout>now</shout> [long-pause] [laugh] <emphasis>yes</emphasis>";
  expect(findInvalidDeliveryTags(text, true)).toEqual(["<shout>", "</shout>"]);
  // Without xAI tag support, every tag is invalid
  const all = findInvalidDeliveryTags("Hi [pause] there", false);
  expect(all).toEqual(["[pause]"]);
});

test("segmentParagraphsForTts groups complete paragraphs within limits", () => {
  const paragraphs = ["aaaa", "bbbb", "cccc", "dddd", "eeee", "ffff"];
  expect(
    segmentParagraphsForTts(paragraphs, { maxChars: 11, maxParagraphs: 5 }),
  ).toEqual(["aaaa\n\nbbbb", "cccc\n\ndddd", "eeee\n\nffff"]);
  expect(
    segmentParagraphsForTts(paragraphs, { maxChars: 100, maxParagraphs: 2 }),
  ).toEqual(["aaaa\n\nbbbb", "cccc\n\ndddd", "eeee\n\nffff"]);
  expect(segmentParagraphsForTts([], {})).toEqual([]);
});

test("validatePerformanceScript enforces length band and tag safety", () => {
  const original = "one two three four five six seven eight nine ten.";
  const good = validatePerformanceScript(
    original,
    ["one two three four five six seven eight nine ten! [pause]"],
    true,
  );
  expect(good.valid).toBe(true);

  const bloated = validatePerformanceScript(
    original,
    [`${original} ${original} ${original}`],
    true,
  );
  expect(bloated.valid).toBe(false);

  const badTag = validatePerformanceScript(
    original,
    ["one two three four five six seven eight nine <shout>ten</shout>."],
    true,
  );
  expect(badTag.valid).toBe(false);
});

test("countDeliveryTags counts openings and inline tags once", () => {
  expect(countDeliveryTags("A [pause] B <slow>slow words</slow> [laugh]")).toBe(
    3,
  );
});

test("countWords counts whitespace-separated tokens", () => {
  expect(countWords("  one   two three ")).toBe(3);
  expect(countWords("")).toBe(0);
});

test("edit application - state edits then performance validation accepts sane pass", () => {
  const original =
    "Opening words stay here for length checks and more words to keep ratio safe.\n\nSecond paragraph stays as is today.";
  const state = new ScriptEditState(original);
  const applied = state.replace(
    2,
    "Second paragraph stays as is today. [pause]",
  );
  expect(applied.ok).toBe(true);
  expect(state.edits.length).toBe(1);
  const validation = validatePerformanceScript(
    original,
    state.paragraphs,
    true,
  );
  expect(validation.valid).toBe(true);
  // Untouched paragraph stays byte-identical through the edit path.
  expect(state.paragraphs[0]).toBe(
    "Opening words stay here for length checks and more words to keep ratio safe.",
  );
});

test("edit application - bloated performance edits fail validation fallback", () => {
  const original =
    "one two three four five six seven eight nine ten eleven twelve.";
  const state = new ScriptEditState(original);
  state.replace(1, `${original} ${original} ${original} ${original}`);
  const validation = validatePerformanceScript(
    original,
    state.paragraphs,
    true,
  );
  expect(validation.valid).toBe(false);
  expect(
    validation.issues.some((issue) => issue.includes("changed length")),
  ).toBe(true);
});

test("tag budget - per-paragraph cap enforced in edited validation", () => {
  expect(MAX_TAGS_PER_PARAGRAPH).toBe(2);
  const original =
    "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda.";
  const overCap = validateEditedScript(original, [
    "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda [pause] [sigh] [breath]",
  ]);
  expect(overCap.valid).toBe(false);
  expect(
    overCap.issues.some((issue) => issue.includes("delivery tags (max 2)")),
  ).toBe(true);

  const atCap = validateEditedScript(original, [
    "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda [pause] [sigh]",
  ]);
  expect(atCap.valid).toBe(true);
});

test("tag budget - guidance-banned tags rejected by validator", () => {
  const original =
    "one two three four five six seven eight nine ten eleven twelve.";
  // [giggle] is API-supported but banned by the podcast guidance.
  expect(findInvalidDeliveryTags("hi [giggle] there", true)).toContain(
    "[giggle]",
  );
  expect(findInvalidDeliveryTags("hi [cry] there", true)).toContain("[cry]");
  expect(findInvalidDeliveryTags("hi [lip-smack] there", true)).toContain(
    "[lip-smack]",
  );
  expect(
    findInvalidDeliveryTags("hi <singing>la</singing> there", true),
  ).toContain("<singing>");
  // Permitted tags stay valid.
  expect(findInvalidDeliveryTags("hi [pause] <soft>warm</soft>", true)).toEqual(
    [],
  );

  const banned = validatePerformanceScript(
    original,
    [
      "one two three four five six seven eight nine ten eleven [giggle] twelve.",
    ],
    true,
  );
  expect(banned.valid).toBe(false);
  expect(
    banned.issues.some((issue) => issue.includes("invalid delivery tags")),
  ).toBe(true);
});

test("segment limit - oversize paragraph splits on word boundaries under maxChars", () => {
  const big = Array.from({ length: 1800 }, () => "word").join(" ");
  expect(big.length).toBeGreaterThan(8000);
  const segments = segmentParagraphsForTts([big], {
    maxChars: OPENAI_TTS_MAX_CHARS,
    maxParagraphs: 10,
  });
  // 9000-char paragraph at 4000 must yield several capped segments.
  expect(segments.length).toBeGreaterThanOrEqual(3);
  for (const segment of segments) {
    expect(segment.length).toBeLessThanOrEqual(OPENAI_TTS_MAX_CHARS);
    // Word-boundary split: boundaries never cut a word.
    expect(segment.split(/\s+/).every((w) => w === "word")).toBe(true);
  }
  // No text lost: rejoining with single spaces reconstructs the paragraph.
  expect(segments.join(" ")).toBe(big);
});

test("validator floor - 0.65 ratio accepted, 0.5 rejected as removed too much", () => {
  const words = Array.from({ length: 100 }, (_v, i) => `w${i}`).join(" ");
  const kept65 = Array.from({ length: 65 }, (_v, i) => `w${i}`).join(" ");
  const kept50 = Array.from({ length: 50 }, (_v, i) => `w${i}`).join(" ");
  const accepted = validateEditedScript(words, [kept65]);
  expect(accepted.valid).toBe(true);
  const rejected = validateEditedScript(words, [kept50]);
  expect(rejected.valid).toBe(false);
  expect(
    rejected.issues.some((issue) => issue.includes("removed too much")),
  ).toBe(true);
});

test("segment limit - OpenAI path stays under the 4096-char API cap", () => {
  expect(OPENAI_TTS_MAX_CHARS).toBe(4000);
  expect(XAI_TTS_MAX_CHARS).toBe(5200);
  const paragraphs = ["a".repeat(1500), "b".repeat(1500), "c".repeat(1500)];
  // 4500 chars total fits one xAI segment but must split for OpenAI.
  const xaiSegments = segmentParagraphsForTts(paragraphs, {
    maxChars: XAI_TTS_MAX_CHARS,
    maxParagraphs: 10,
  });
  expect(xaiSegments.length).toBe(1);
  expect(xaiSegments[0].length).toBeLessThanOrEqual(XAI_TTS_MAX_CHARS + 2);

  const openaiSegments = segmentParagraphsForTts(paragraphs, {
    maxChars: OPENAI_TTS_MAX_CHARS,
    maxParagraphs: 10,
  });
  expect(openaiSegments.length).toBeGreaterThan(1);
  for (const segment of openaiSegments) {
    // Oversized single paragraphs are kept whole, but these fit the limit.
    expect(segment.length).toBeLessThanOrEqual(OPENAI_TTS_MAX_CHARS);
  }
});
