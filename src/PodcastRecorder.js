import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'
import ffmpeg from 'fluent-ffmpeg'

export default class PodcastRecorder {
  constructor () {
    this.openai = new OpenAI()
  }

  async createRecording (podcastText, filePath) {
    const textChunks = podcastText
      .split('\n')
      .filter((chunk) => chunk.trim() !== '')

    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i]

      const mp3 = await this.openai.audio.speech.create({
        model: 'tts-1-hd',
        voice: 'nova',
        input: chunk
      })

      const buffer = Buffer.from(await mp3.arrayBuffer())
      const partFilePath = filePath.replace(/(\.mp3)$/, `-${i}$1`)
      await fs.promises.writeFile(partFilePath, buffer)
    }

    const directory = path.dirname(filePath)
    await this.concatenateMP3Files(directory, filePath)
  }

  async concatenateMP3Files (directory, outputFilename) {
    return new Promise((resolve, reject) => {
      // Read the directory for MP3 files
      fs.readdir(directory, (err, files) => {
        if (err) {
          reject(new Error(`Error reading directory: ${err}`))
          return
        }

        // Filter and sort MP3 files
        // Filter only the partial MP3 files that match the pattern 'outputFilename-<index>.mp3'
        const mp3Files = files
          .filter((file) => file.match(/-\d+\.mp3$/))
          .map((file) => path.join(directory, file))
          .sort((a, b) =>
            a.localeCompare(b, undefined, {
              numeric: true,
              sensitivity: 'base'
            })
          )

        // Create a new FFmpeg command
        const command = ffmpeg()

        // Add each MP3 file as an input
        mp3Files.forEach((file) => command.input(file))

        // Use the concat filter to concatenate the files
        command
          .on('error', (err) => {
            reject(new Error(`Error concatenating files: ${err}`))
          })
          .on('end', async () => {
            // Delete the partial MP3 files after concatenation
            for (const file of mp3Files) {
              try {
                await fs.promises.unlink(file)
              } catch (err) {
                console.error('Error deleting file:', file, err)
              }
            }
            resolve(`Concatenation finished: ${outputFilename}`)
          })
          .mergeToFile(outputFilename, directory) // Specify the output file and a temporary directory
      })
    })
  }
}
