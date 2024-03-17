# HackerNews Podcaster

<p align="center">
    <img src="images/A_stout_wizard_in_a_study_speaking_into_mic.jpg" alt="A stout wizard speaking into mic - Leonardo AI" width="600">
</p>


The HackerNews Podcaster is a JavaScript application that utilizes the power of OpenAI's language model to transform the top stories from Hacker News into a comprehensive podcast script! (and now with audio!)

[![asciicast](https://asciinema.org/a/AiBAoZNW9qny7diWAUR45UElp.svg)](https://asciinema.org/a/AiBAoZNW9qny7diWAUR45UElp)

## Example Output

- [Podcast created on Nov 7, 2023 Audio](example/2023-11-07_podcast.mp3)
- [Podcast created on Nov 7, 2023 Transcription](example/2023-11-07_transcription.txt)

## Overview

As a listener of the [Hacker News Recap](https://hackernewsrecap.buzzsprout.com/) by [Wondercraft.ai](https://www.wondercraft.ai), I became curious about the process of reproducing it using ChatGPT. By leveraging the advanced language processing capabilities of both OpenAI's GPT-3 and GPT-4 models, I created the HackerNews Podcaster. This application fetches the top stories from Hacker News, condenses them into concise summaries, and then assembles these summaries into a conversational and engaging podcast script.

Here's the flow of the application:

1. Fetching the top stories from Hacker News.
2. Utilizing GPT-3 to summarize each of the top stories.
3. Generating a podcast script from these summaries using GPT-4.
4. Displaying the script on the console.

With this project, you can quickly and automatically generate podcasts based on the latest technology news and trends. The generated podcast is output as an MP3 file.

## Additional Requirements
This project requires `ffmpeg` to be installed on your local machine to process and generate the final MP3 audio file. Please ensure that `ffmpeg` is installed and accessible from your command line.

## Pre-requisites
Make sure to have `node` and `npm` installed on your machine.

## Environment Configuration 
This project uses an environment variable for the OpenAI API Key. Make sure you have the `OPENAI_API_KEY` environment variable set in a `.env` file at the root of your project or in your system environment variables.

## Note
Ensure that the OpenAI key provided has required permissions and enough quota for making summarization and text generation requests to OpenAI API.
