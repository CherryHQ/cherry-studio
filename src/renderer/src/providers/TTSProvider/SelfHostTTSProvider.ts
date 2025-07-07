import type { TTSSpeakOptions, Voice } from '@/types/tts'

import { BaseTTSProvider, TTSCheckResult } from './BaseTTSProvider'

export class SelfHostTTSProvider extends BaseTTSProvider {
  private sentenceQueue: string[] = []
  private audioQueue: (Blob | 'EOS')[] = [] // EOS = End of Stream
  private isSpeaking: boolean = false
  private audioConsumerPromise: Promise<void> | null = null
  private audioProducerPromise: Promise<void> | null = null

  public async getVoices(): Promise<Voice[]> {
    // For self-hosted services, we currently don't support dynamic voice lists.
    return Promise.resolve([{ id: 'default', name: 'Default' }])
  }

  private splitIntoSentences(text: string): string[] {
    if (!text) return []
    // Regex to split by sentences, including both English and Chinese punctuation.
    const sentences = text.match(/[^.!?。？！]+[.!?。？！\n]*/g) || [text]
    return sentences.map((s) => s.trim()).filter((s) => s.length > 0)
  }

  public async speak(options: TTSSpeakOptions): Promise<void> {
    await this.stop() // Ensure everything is clean before starting

    const { text, volume } = options
    if (!text.trim()) {
      return
    }

    this.isSpeaking = true
    this.sentenceQueue = this.splitIntoSentences(text)

    if (this.sentenceQueue.length > 0) {
      this.audioProducerPromise = this.producerLoop()
      this.audioConsumerPromise = this.consumerLoop(volume)
    }
  }

  public async stop(): Promise<void> {
    if (this.isSpeaking) {
      this.isSpeaking = false
      // Wait for loops to terminate gracefully
      await Promise.allSettled([this.audioProducerPromise, this.audioConsumerPromise])
    }
    this.sentenceQueue = []
    this.audioQueue = []
    await super.stop() // Stop the actual audio player
  }

  private async producerLoop(): Promise<void> {
    while (this.isSpeaking && this.sentenceQueue.length > 0) {
      const sentence = this.sentenceQueue.shift()!
      try {
        const audioBlob = await this.fetchAudio(sentence)
        if (this.isSpeaking) {
          this.audioQueue.push(audioBlob)
        }
      } catch (error) {
        console.error(`[SelfHostTTSProvider] Failed to fetch audio for: "${sentence}"`, error)
        this.isSpeaking = false // Stop everything on error
      }
    }
    // When done, push the End of Stream signal
    if (this.isSpeaking) {
      this.audioQueue.push('EOS')
    }
  }

  private async consumerLoop(volume?: number): Promise<void> {
    while (this.isSpeaking) {
      if (this.audioQueue.length > 0) {
        const nextItem = this.audioQueue.shift()!

        if (nextItem === 'EOS') {
          this.isSpeaking = false // End of stream, we're done
          break
        }

        try {
          // This promise resolves when the audio has finished playing
          await this.audioPlayer.playBlob(nextItem, volume)
        } catch (error) {
          console.error('[SelfHostTTSProvider] Failed to play audio blob.', error)
          this.isSpeaking = false // Stop on playback error
        }
      } else {
        // Wait for the producer to push more audio
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  }

  private async fetchAudio(text: string): Promise<Blob> {
    const config = this.provider.self_host

    if (!config?.url) {
      throw new Error('Self-host TTS configuration is incomplete. URL is missing.')
    }

    // The body from config is expected to be a string.
    const bodyString =
      config.body && config.body.trim() !== ''
        ? config.body
        : JSON.stringify({ model: 'tts-1', input: '{{input}}' })

    let bodyObject
    try {
      // Step 1: Parse the string from the config into a real object.
      bodyObject = JSON.parse(bodyString)
    } catch (e) {
      throw new Error('Self-host TTS body in configuration is not valid JSON.')
    }

    // Step 2: Perform placeholder replacement on the parsed object.
    const placeholderFound = this.findAndReplacePlaceholder(bodyObject, '{{input}}', text)
    if (!placeholderFound) {
      throw new Error("Could not find '{{input}}' placeholder in the TTS body configuration.")
    }

    // Step 3: Stringify the final object for the fetch request.
    const finalBody = JSON.stringify(bodyObject)

    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: finalBody
    })

    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`)
    }

    return response.blob()
  }

  private findAndReplacePlaceholder(obj: any, placeholder: string, replacement: string): boolean {
    let found = false
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          // Recurse into objects and arrays
          if (this.findAndReplacePlaceholder(obj[key], placeholder, replacement)) {
            found = true
          }
        } else if (typeof obj[key] === 'string' && obj[key].includes(placeholder)) {
          // Use replaceAll to handle multiple occurrences of the placeholder in a single string
          obj[key] = obj[key].replaceAll(placeholder, replacement)
          found = true
        }
      }
    }
    return found
  }

  public async check(): Promise<TTSCheckResult> {
    // Correctly get the config from this.provider
    const config = this.provider.self_host
    if (!config?.url) {
      return { valid: false, error: new Error('URL is not configured.') }
    }
    try {
      // Use a HEAD request for a lightweight check
      const response = await fetch(config.url, { method: 'HEAD' })
      return {
        valid: response.ok,
        error: response.ok ? null : new Error(`Server returned status ${response.status}`)
      }
    } catch (error) {
      return { valid: false, error: error as Error }
    }
  }

  protected getDefaultApiHost(): string {
    return ''
  }
}