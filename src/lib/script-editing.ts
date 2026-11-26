/**
 * Paragraph-level script editing state for the agentic improvement loop.
 *
 * Pure and config-free (like format-story.ts) so tests can import it
 * without a .env. The script editor agent mutates a ScriptEditState
 * through tools; each edit touches one paragraph, so no LLM call ever has
 * to regenerate (or re-read) the whole episode to apply a fix.
 */

/**
 * Inline delivery tags permitted by the podcast guidance (see
 * `getSpeechTagGuidance()`). Intentionally narrower than the full xAI TTS
 * set: giggle/cry/mouth-sound tags ([giggle], [cry], [exhale], [lip-smack],
 * [tongue-click], [tsk], [hum-tune]) are supported by the API but banned for
 * this news podcast, and the validator must reject them.
 */
export const ALLOWED_INLINE_TAGS = [
  "[pause]",
  "[long-pause]",
  "[laugh]",
  "[chuckle]",
  "[sigh]",
  "[breath]",
  "[inhale]",
] as const;

/**
 * Wrapping delivery tags permitted by the podcast guidance (open form
 * shown). Singing tags (sing-song, singing) are supported by the API but
 * banned here; the validator rejects them.
 */
export const ALLOWED_WRAPPING_TAGS = [
  "whisper",
  "soft",
  "slow",
  "loud",
  "fast",
  "emphasis",
  "build-intensity",
  "decrease-intensity",
  "higher-pitch",
  "lower-pitch",
] as const;

/** Maximum delivery tags per paragraph (guidance budget: never more than 2). */
export const MAX_TAGS_PER_PARAGRAPH = 2;

/**
 * Full wrapping vocabulary for positive matching: permitted tags plus the
 * guidance-banned singing tags. Matching only this vocabulary keeps quoted
 * HTML (`<em>`, `<a>`, `<br>`) from article text out of the validator.
 */
const WRAPPING_TAG_PATTERN =
  "<\\/?(whisper|soft|slow|loud|fast|emphasis|build-intensity|decrease-intensity|higher-pitch|lower-pitch|sing-song|singing)>";

/** Split a script into paragraphs on blank lines, dropping empties. */
export function splitParagraphs(script: string): string[] {
  return script
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Join paragraphs back into a script with blank-line separators. */
export function joinParagraphs(paragraphs: string[]): string {
  return paragraphs.join("\n\n");
}

/** Render paragraphs with 1-based [Pn] markers for agent prompts. */
export function numberParagraphs(paragraphs: string[]): string {
  return paragraphs.map((p, i) => `[P${i + 1}] ${p}`).join("\n\n");
}

/** Count words in a block of text. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const ALLOWED_INLINE_TAG_SET = new Set<string>(ALLOWED_INLINE_TAGS);
const OPENING_WRAPPING_TAG_PATTERN = new RegExp(
  `<(${ALLOWED_WRAPPING_TAGS.join("|")})>`,
  "g",
);

/** Count delivery-tag openings/inline tags in a script (closers excluded). */
export function countDeliveryTags(text: string): number {
  let count = 0;
  for (const match of text.matchAll(/\[[a-z][a-z-]*\]/g)) {
    if (ALLOWED_INLINE_TAG_SET.has(match[0])) count++;
  }
  for (const _ of text.matchAll(OPENING_WRAPPING_TAG_PATTERN)) {
    count++;
  }
  return count;
}

/**
 * Segmentation targets per TTS provider. OpenAI's /v1/audio/speech caps
 * input at 4096 characters, so the OpenAI path stays under that with 4000;
 * xAI tolerates the larger story-sized default.
 */
export const XAI_TTS_MAX_CHARS = 5_200;
export const OPENAI_TTS_MAX_CHARS = 4_000;

export interface TtsSegmentOptions {
  /** Maximum characters per synthesis request. Defaults to XAI_TTS_MAX_CHARS. */
  maxChars?: number;
  /** Maximum paragraphs per synthesis request. Defaults to 5. */
  maxParagraphs?: number;
}

/**
 * Split one oversize paragraph on word boundaries (never mid-word) so every
 * piece fits `maxChars`. A single token longer than `maxChars` has no
 * boundary to use and is hard-split as the only fallback.
 */
function splitOnWordBoundaries(text: string, maxChars: number): string[] {
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    throw new RangeError(
      `maxChars must be a positive finite number, got ${maxChars}`,
    );
  }
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const pieces: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        pieces.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += maxChars) {
        pieces.push(word.slice(i, i + maxChars));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      pieces.push(current);
      current = word;
    }
  }
  if (current) pieces.push(current);
  return pieces.length > 0 ? pieces : [text];
}

/**
 * Group complete paragraphs into story-sized TTS requests. Sending several
 * paragraphs per request lets the voice carry intonation across transitions,
 * instead of resetting its prosody at every paragraph boundary. A single
 * paragraph longer than `maxChars` is split on word boundaries so no
 * emitted segment exceeds `maxChars`.
 */
export function segmentParagraphsForTts(
  paragraphs: string[],
  options: TtsSegmentOptions = {},
): string[] {
  const maxChars = options.maxChars ?? XAI_TTS_MAX_CHARS;
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    throw new RangeError(
      `maxChars must be a positive finite number, got ${maxChars}`,
    );
  }
  const maxParagraphs = options.maxParagraphs ?? 5;
  const expanded: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      expanded.push(...splitOnWordBoundaries(paragraph, maxChars));
    } else {
      expanded.push(paragraph);
    }
  }
  const segments: string[] = [];
  let current: string[] = [];

  const currentChars = () =>
    current.reduce((sum, p) => sum + p.length, 0) +
    Math.max(0, current.length - 1) * 2;

  for (const paragraph of expanded) {
    const wouldExceed =
      current.length > 0 &&
      (current.length >= maxParagraphs ||
        currentChars() + 2 + paragraph.length > maxChars);
    if (wouldExceed) {
      segments.push(joinParagraphs(current));
      current = [];
    }
    current.push(paragraph);
  }
  if (current.length > 0) segments.push(joinParagraphs(current));
  return segments;
}

/**
 * Strip a leading "[Pn]" marker an agent may echo back when returning
 * paragraph text copied from a numbered prompt.
 */
function stripParagraphMarker(text: string): string {
  return text.replace(/^\[P\d+\]\s*/, "");
}

/** Normalize agent-supplied text into one or more clean paragraphs. */
function normalizeParagraphInput(text: string): string[] {
  return splitParagraphs(text)
    .map((p) => stripParagraphMarker(p).trim())
    .filter((p) => p.length > 0);
}

/**
 * Find delivery-tag-looking tokens that xAI TTS does not understand.
 * Unknown tags are read aloud as literal words, so they must be caught.
 * When `xaiTagsAllowed` is false (non-xAI voice), every known tag is
 * invalid because other providers would speak them literally.
 */
export function findInvalidDeliveryTags(
  text: string,
  xaiTagsAllowed: boolean,
): string[] {
  const invalid = new Set<string>();
  const inlineAllowed = new Set<string>(
    xaiTagsAllowed ? ALLOWED_INLINE_TAGS : [],
  );
  const wrapAllowed = new Set<string>(
    xaiTagsAllowed ? ALLOWED_WRAPPING_TAGS : [],
  );

  for (const match of text.matchAll(/\[[a-z][a-z-]*\]/g)) {
    if (!inlineAllowed.has(match[0])) invalid.add(match[0]);
  }
  for (const match of text.matchAll(new RegExp(WRAPPING_TAG_PATTERN, "g"))) {
    if (!wrapAllowed.has(match[1])) invalid.add(match[0]);
  }
  return [...invalid];
}

/** One applied edit, for logging and auditing the agent's work. */
export interface EditRecord {
  op: "replace" | "insert" | "delete";
  /** 1-based paragraph id the edit targeted (insert: the preceding id). */
  paragraphId: number;
  beforeWords: number;
  afterWords: number;
}

/** Result shape every edit operation returns (also the tool output). */
export interface EditResult {
  ok: boolean;
  error?: string;
  paragraphCount: number;
  totalWords: number;
}

/**
 * Mutable paragraph state for one improvement iteration. All ids are
 * 1-based and always refer to the CURRENT paragraph list, so an agent
 * can re-read after each edit to see fresh numbering.
 */
export class ScriptEditState {
  paragraphs: string[];
  readonly edits: EditRecord[] = [];

  constructor(script: string) {
    this.paragraphs = splitParagraphs(script);
  }

  get paragraphCount(): number {
    return this.paragraphs.length;
  }

  totalWords(): number {
    return this.paragraphs.reduce((sum, p) => sum + countWords(p), 0);
  }

  getScript(): string {
    return joinParagraphs(this.paragraphs);
  }

  /** Read paragraphs by 1-based ids; unknown ids are skipped. */
  read(ids: number[]): Array<{ id: number; text: string; words: number }> {
    const out: Array<{ id: number; text: string; words: number }> = [];
    for (const id of ids) {
      const text = this.paragraphs[id - 1];
      if (text !== undefined) out.push({ id, text, words: countWords(text) });
    }
    return out;
  }

  private result(error?: string): EditResult {
    return {
      ok: error === undefined,
      ...(error !== undefined ? { error } : {}),
      paragraphCount: this.paragraphCount,
      totalWords: this.totalWords(),
    };
  }

  private isValidId(id: number): boolean {
    return Number.isInteger(id) && id >= 1 && id <= this.paragraphCount;
  }

  /** Replace one paragraph. Replacement text may span several paragraphs. */
  replace(id: number, text: string): EditResult {
    if (!this.isValidId(id)) {
      return this.result(
        `Paragraph ${id} does not exist (1-${this.paragraphCount})`,
      );
    }
    const replacement = normalizeParagraphInput(text);
    if (replacement.length === 0) {
      return this.result("Replacement text is empty");
    }
    const beforeWords = countWords(this.paragraphs[id - 1]);
    this.paragraphs.splice(id - 1, 1, ...replacement);
    this.edits.push({
      op: "replace",
      paragraphId: id,
      beforeWords,
      afterWords: replacement.reduce((s, p) => s + countWords(p), 0),
    });
    return this.result();
  }

  /** Insert paragraph(s) after `afterId` (0 inserts at the very start). */
  insertAfter(afterId: number, text: string): EditResult {
    if (
      !Number.isInteger(afterId) ||
      afterId < 0 ||
      afterId > this.paragraphCount
    ) {
      return this.result(
        `Insert position ${afterId} is out of range (0-${this.paragraphCount})`,
      );
    }
    const inserted = normalizeParagraphInput(text);
    if (inserted.length === 0) {
      return this.result("Inserted text is empty");
    }
    this.paragraphs.splice(afterId, 0, ...inserted);
    this.edits.push({
      op: "insert",
      paragraphId: afterId,
      beforeWords: 0,
      afterWords: inserted.reduce((s, p) => s + countWords(p), 0),
    });
    return this.result();
  }

  /** Delete one paragraph. Refuses to delete the last remaining one. */
  delete(id: number): EditResult {
    if (!this.isValidId(id)) {
      return this.result(
        `Paragraph ${id} does not exist (1-${this.paragraphCount})`,
      );
    }
    if (this.paragraphCount <= 1) {
      return this.result("Cannot delete the only remaining paragraph");
    }
    const beforeWords = countWords(this.paragraphs[id - 1]);
    this.paragraphs.splice(id - 1, 1);
    this.edits.push({
      op: "delete",
      paragraphId: id,
      beforeWords,
      afterWords: 0,
    });
    return this.result();
  }
}

export interface ValidateEditedScriptOptions {
  /**
   * When defined, also reject delivery tags unsupported by the active voice
   * provider (guidance-banned tags when true; all delivery tags when false).
   */
  xaiTagsAllowed?: boolean;
}

/**
 * Validate an edited script before accepting it. Guards against an agent
 * gutting the episode, leaking prompt markers, emitting markdown
 * structure the TTS step would read aloud, or over-stacking delivery tags.
 * Deliberately permissive elsewhere — editorial quality is the agents'
 * job, not this check's.
 */
export function validateEditedScript(
  originalScript: string,
  editedParagraphs: string[],
  options?: ValidateEditedScriptOptions,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (editedParagraphs.length === 0) {
    issues.push("edited script has no paragraphs");
    return { valid: false, issues };
  }
  if (editedParagraphs.some((p) => p.trim().length === 0)) {
    issues.push("edited script contains an empty paragraph");
  }

  editedParagraphs.forEach((paragraph, index) => {
    const tagCount = countDeliveryTags(paragraph);
    if (tagCount > MAX_TAGS_PER_PARAGRAPH) {
      issues.push(
        `paragraph ${index + 1} has ${tagCount} delivery tags (max ${MAX_TAGS_PER_PARAGRAPH})`,
      );
    }
  });

  if (options?.xaiTagsAllowed !== undefined) {
    const invalidTags = new Set<string>();
    for (const paragraph of editedParagraphs) {
      for (const tag of findInvalidDeliveryTags(
        paragraph,
        options.xaiTagsAllowed,
      )) {
        invalidTags.add(tag);
      }
    }
    if (invalidTags.size > 0) {
      issues.push(`invalid delivery tags: ${[...invalidTags].join(", ")}`);
    }
  }

  const originalWords = countWords(originalScript);
  const editedWords = editedParagraphs.reduce(
    (sum, p) => sum + countWords(p),
    0,
  );
  if (originalWords > 0) {
    const ratio = editedWords / originalWords;
    if (ratio < 0.6) {
      issues.push(
        `edit removed too much text (${originalWords} -> ${editedWords} words)`,
      );
    } else if (ratio > 3.0) {
      issues.push(
        `word count changed implausibly (${originalWords} -> ${editedWords})`,
      );
    }
  }

  const edited = joinParagraphs(editedParagraphs);
  if (/\[P\d+\]/.test(edited)) {
    issues.push("edited script contains leaked [Pn] prompt markers");
  }
  if (/^#{1,6}\s/m.test(edited)) {
    issues.push("edited script contains markdown headings");
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Validate a performance-director pass. This pass may change rhythm and
 * delivery, but must not materially rewrite the episode: word count stays
 * within 85-118% and every delivery tag must be one the voice understands.
 */
export function validatePerformanceScript(
  originalScript: string,
  editedParagraphs: string[],
  xaiTagsAllowed: boolean,
): { valid: boolean; issues: string[] } {
  const base = validateEditedScript(originalScript, editedParagraphs, {
    xaiTagsAllowed,
  });
  const issues = [...base.issues];

  const originalWords = countWords(originalScript);
  const editedWords = editedParagraphs.reduce(
    (sum, p) => sum + countWords(p),
    0,
  );
  if (originalWords > 0) {
    const ratio = editedWords / originalWords;
    if (ratio < 0.85 || ratio > 1.18) {
      issues.push(
        `performance pass changed length too much (${originalWords} -> ${editedWords} words)`,
      );
    }
  }

  return { valid: issues.length === 0, issues };
}
