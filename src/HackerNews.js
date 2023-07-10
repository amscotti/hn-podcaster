import * as cheerio from 'cheerio'

const STORIES_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json'
const ITEM_URL_BASE = 'https://hacker-news.firebaseio.com/v0/item'

export default class HackerNews {
  static async fetchTopStories (count = 5) {
    const response = await fetch(STORIES_URL)
    return (await response.json()).slice(0, count)
  }

  static async fetchStory (id) {
    const storyResponse = await fetch(`${ITEM_URL_BASE}/${id}.json`)
    return await storyResponse.json()
  }

  static async getWebPageText (url) {
    const response = await fetch(url)
    const body = await response.text()
    const $ = cheerio.load(body)

    $('script, style').remove()
    $('.header').remove()
    $('.footer').remove()
    $('.sidebar').remove()
    $('.ad').remove()

    const cleanedText = $('body').text().replace(/\\n|\\s+/g, ' ').trim()
    return cleanedText.replace(/\s+/g, ' ')
  }
}
