/**
 * Bounded-pool helper shared by workflow and download fan-outs.
 * No imports of its own, so no cycle.
 */

/**
 * Run `worker` over `items` with at most `concurrency` in flight,
 * preserving input order in the results. No new dependency.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  const safeConcurrency =
    Number.isFinite(concurrency) && concurrency >= 1
      ? Math.floor(concurrency)
      : 1;
  const limit = Math.min(safeConcurrency, items.length);
  let next = 0;
  let failed = false;
  const runners = Array.from({ length: limit }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });
  await Promise.all(runners);
  return results;
}
