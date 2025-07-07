// =================================================================================
// 导入依赖
// =================================================================================
import { TTSProviderConfig, Voice } from '@/types'
import { BaseTTSProvider } from './BaseTTSProvider'

// =================================================================================
// 配置接口定义
// =================================================================================
export interface SelfHostTTSConfig {
  url: string
  body: string
}

// =================================================================================
// SelfHostTTSProvider 类定义
// =================================================================================
export class SelfHostTTSProvider extends BaseTTSProvider {
  private config: SelfHostTTSConfig
  private audioPlayer: HTMLAudioElement
  private sentences: string[] = []
  private currentIndex = 0
  private isPlaying = false
  private abortController: AbortController | null = null
  private preloadedAudioUrl: string | null = null

  constructor(config: TTSProviderConfig) {
    super()
    this.config = config.self_host as SelfHostTTSConfig
    this.audioPlayer = new Audio()
    this.audioPlayer.onended = this.handleAudioEnded.bind(this)
    this.audioPlayer.onplay = this.handleAudioPlay.bind(this)
  }

  public async getVoices(): Promise<Voice[]> {
    return Promise.resolve([{ id: 'default', name: 'Default' }])
  }

  public async speak(text: string): Promise<void> {
    if (this.isPlaying) {
      this.stop()
    }
    if (!this.config?.url) {
      console.error('Self-host TTS URL is not configured.')
      return
    }
    this.sentences = this.splitIntoSentences(text)
    if (this.sentences.length === 0) return
    this.isPlaying = true
    this.currentIndex = 0
    this.playNextSentence()
  }

  public stop(): void {
    this.isPlaying = false
    this.audioPlayer.pause()
    this.audioPlayer.src = ''
    this.sentences = []
    this.currentIndex = 0
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    if (this.preloadedAudioUrl) {
      URL.revokeObjectURL(this.preloadedAudioUrl)
      this.preloadedAudioUrl = null
    }
  }

  public async check(): Promise<{ valid: boolean; message?: string }> {
    if (!this.config?.url) {
      return { valid: false, message: 'URL is not configured.' }
    }
    try {
      const response = await fetch(this.config.url, { method: 'HEAD' })
      return { valid: response.ok, message: response.ok ? '' : `Server returned status ${response.status}` }
    } catch (error) {
      return { valid: false, message: (error as Error).message }
    }
  }

  private playNextSentence(): void {
    if (!this.isPlaying || this.currentIndex >= this.sentences.length) {
      this.stop()
      return
    }
    if (this.preloadedAudioUrl) {
      this.audioPlayer.src = this.preloadedAudioUrl
      this.audioPlayer.play()
      this.preloadedAudioUrl = null
    } else {
      this.fetchAndPlayCurrentSentence()
    }
  }

  private async fetchAndPlayCurrentSentence(): Promise<void> {
    const sentence = this.sentences[this.currentIndex]
    if (!sentence) return
    try {
      const audioBlob = await this.fetchAudio(sentence)
      const audioUrl = URL.createObjectURL(audioBlob)
      this.audioPlayer.src = audioUrl
      this.audioPlayer.play()
    } catch (error) {
      console.error('Error fetching audio for sentence:', sentence, error)
      this.currentIndex++
      this.playNextSentence()
    }
  }

  private async preloadNextSentence(): Promise<void> {
    const nextIndex = this.currentIndex + 1
    if (nextIndex >= this.sentences.length) return
    const nextSentence = this.sentences[nextIndex]
    try {
      const audioBlob = await this.fetchAudio(nextSentence)
      this.preloadedAudioUrl = URL.createObjectURL(audioBlob)
    } catch (error) {
      console.error('Error preloading audio for sentence:', nextSentence, error)
    }
  }

  private async fetchAudio(text: string): Promise<Blob> {
    this.abortController = new AbortController()
    const finalBody = this.config.body.replace('{{input}}', text)
    const response = await fetch(this.config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: finalBody,
      signal: this.abortController.signal
    })
    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`)
    }
    return response.blob()
  }

  private handleAudioEnded(): void {
    if (this.audioPlayer.src) {
      URL.revokeObjectURL(this.audioPlayer.src)
    }
    this.currentIndex++
    this.playNextSentence()
  }

  private handleAudioPlay(): void {
    this.preloadNextSentence()
  }

  private splitIntoSentences(text: string): string[] {
    if (!text) return []
    return (
      text
        .replace(/(\r\n|\n|\r)/gm, ' ')
        .match(/[^.!?。！？]+[.!?。！？]*/g)
        ?.filter((s) => s.trim()) || []
    )
  }
}