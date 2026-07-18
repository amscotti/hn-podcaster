/**
 * Pure helpers for formatting story content for downstream agents.
 * Kept free of config/providers so tests can import without a .env.
 */

/**
 * Keep only stories whose article body downloaded successfully, in original
 * rank order, capped at `storyCount`. Failed downloads are dropped so script
 * generation never sees empty-content placeholders.
 */
export function keepSuccessfulDownloads<
  T extends { text: string },
>(
  stories: T[],
  storyCount: number,
): { kept: T[]; dropped: T[] } {
  const dropped = stories.filter((s) => s.text.trim().length === 0);
  const kept = stories
    .filter((s) => s.text.trim().length > 0)
    .slice(0, Math.max(0, storyCount));
  return { kept, dropped };
}

/**
 * Format story metadata + AI summary for the script-writing agents.
 *
 * Intentionally omits the raw article body and full comment dump — those are
 * only needed during summarization. Re-feeding them into script/improve loops
 * inflates token cost and context without improving script quality, since the
 * summary already weaves in community perspectives.
 */
export function formatStoryContent(
  story: { title: string; url?: string; time: number },
  summary: string,
): string {
  const formatDate = (unixTimestamp: number): string => {
    const date = new Date(unixTimestamp * 1000);
    return date.toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  };

  const urlLine = story.url ? `URL: ${story.url}\n` : "";

  return `
## ${story.title}
Posted Date: ${formatDate(story.time)}
${urlLine}
### Summary and Talking Points
${summary}
  `.trim();
}
