const STORIES_URL = "https://hacker-news.firebaseio.com/v0/topstories.json";
const ITEM_URL_BASE = "https://hacker-news.firebaseio.com/v0/item";

/**
 * Fetches top stories from the Hacker News API
 * @returns {Promise<number[]>} Array of story IDs
 */
export async function fetchTopStories() {
  const response = await fetch(STORIES_URL);
  return await response.json();
}

/**
 * Fetches a story by ID from the Hacker News API
 * @param {number} id Story ID to fetch
 * @returns {Promise<{
 *   id: number,
 *   title: string,
 *   url: string,
 *   score: number,
 *   by: string,
 *   time: number,
 *   descendants: number,
 *   kids: number[]
 * }>} Story object from the Hacker News API
 */
export async function fetchStory(id) {
  const storyResponse = await fetch(`${ITEM_URL_BASE}/${id}.json`);
  return await storyResponse.json();
}
