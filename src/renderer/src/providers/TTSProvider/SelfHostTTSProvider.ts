import type { TTSSpeakOptions, TTSVoice } from '@renderer/types/tts'

import { BaseTTSProvider, TTSCheckResult } from './BaseTTSProvider'

export class SelfHostTTSProvider extends BaseTTSProvider {
  private sentenceQueue: string[] = []
  private audioQueue: (Blob | 'EOS')[] = []
  private isSpeaking: boolean = false
  private audioConsumerPromise: Promise<void> | null = null
  private abortController: AbortController | null = null

  public async getVoices(): Promise<TTSVoice[]> {
    return Promise.resolve([{ id: 'default', name: 'Default', lang: 'en-US' }])
  }

  private splitIntoSentences(text: string): string[] {
    if (!text) return []
    const sentences = text.match(/[^.!?。？！]+[.!?。？！\\n]*/g) || [text]
    return sentences.map((s) => s.trim()).filter((s) => s.length > 0)
  }

  public speak(options: TTSSpeakOptions): Promise<void> {
    this.stop()

    const { text, volume, onError } = options
    if (!text.trim()) {
      return Promise.resolve()
    }

    this.isSpeaking = true
    this.abortController = new AbortController()
    this.sentenceQueue = this.splitIntoSentences(text)

    if (this.sentenceQueue.length > 0) {
      this.producerLoop(onError)
      this.audioConsumerPromise = this.consumerLoop(volume, onError)
      return this.audioConsumerPromise.then(() => {})
    }

    return Promise.resolve()
  }

  public async stop(): Promise<void> {
    if (this.isSpeaking) {
      this.isSpeaking = false
      this.abortController?.abort()
      await super.stop()
    }

    this.sentenceQueue = []
    this.audioQueue = []
    this.abortController = null
    this.audioConsumerPromise = null
  }

  private async producerLoop(onError?: (error: Error) => void): Promise<void> {
    while (this.isSpeaking && this.sentenceQueue.length > 0) {
      if (this.audioQueue.length > 5) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        continue
      }

      const sentence = this.sentenceQueue.shift()!
      try {
        const audioBlob = await this.fetchAudio(sentence)
        if (this.isSpeaking) {
          this.audioQueue.push(audioBlob)
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          this.isSpeaking = false
          break
        }

        const err = error instanceof Error ? error : new Error('Failed to fetch audio from self-host service')
        console.error(`[SelfHostTTSProvider] Failed to fetch audio for: "${sentence}"`, err)
        onError?.(err)
        this.isSpeaking = false
      }
    }
    if (this.isSpeaking) {
      this.audioQueue.push('EOS')
    }
  }

  private async consumerLoop(volume?: number, onError?: (error: Error) => void): Promise<void> {
    while (this.isSpeaking) {
      if (this.audioQueue.length > 0) {
        const nextItem = this.audioQueue.shift()!

        if (nextItem === 'EOS') {
          this.isSpeaking = false
          break
        }

        try {
          await this.audioPlayer.playBlob(nextItem, volume)
        } catch (error) {
          const err = error instanceof Error ? error : new Error('Failed to play audio blob')
          console.error('[SelfHostTTSProvider] Failed to play audio blob.', err)
          onError?.(err)
          this.isSpeaking = false
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  }

  private async fetchAudio(text: string): Promise<Blob> {
    const config = this.provider.self_host

    if (!config?.url) {
      throw new Error('Self-host TTS configuration is incomplete. URL is missing.')
    }

    const bodyString =
      config.body && config.body.trim() !== '' ? config.body : JSON.stringify({ model: 'tts-1', input: '{{input}}' })

    let bodyObject
    try {
      bodyObject = JSON.parse(bodyString)
    } catch (e) {
      throw new Error('Self-host TTS body in configuration is not valid JSON.')
    }

    const placeholderFound = this.findAndReplacePlaceholder(bodyObject, '{{input}}', text)
    if (!placeholderFound) {
      throw new Error("Could not find '{{input}}' placeholder in the TTS body configuration.")
    }

    const finalBody = JSON.stringify(bodyObject)

    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: finalBody,
      signal: this.abortController?.signal
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
          if (this.findAndReplacePlaceholder(obj[key], placeholder, replacement)) {
            found = true
          }
        } else if (typeof obj[key] === 'string' && obj[key].includes(placeholder)) {
          obj[key] = obj[key].replaceAll(placeholder, replacement)
          found = true
        }
      }
    }
    return found
  }

  public async check(): Promise<TTSCheckResult> {
    const config = this.provider.self_host
    if (!config?.url) {
      return { valid: false, error: new Error('URL is not configured.') }
    }
    try {
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
