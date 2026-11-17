import { createAudioSpectrum } from './audioSpectrum'
import type { SpeechPlayback } from './speechPlaybackTypes'

export class FinitePlayback extends EventTarget implements SpeechPlayback {
  private readonly spectrum: ReturnType<typeof createAudioSpectrum>
  private closing?: Promise<void>
  constructor(private readonly audio: HTMLAudioElement) {
    super()
    this.spectrum = createAudioSpectrum(audio)
    audio.addEventListener('ended', this.onEnded)
    audio.addEventListener('error', this.onError)
  }
  get analyser(): AnalyserNode | undefined {
    return this.spectrum?.analyser
  }
  async play(): Promise<void> {
    if (this.closing) return
    await this.spectrum?.resume()
    if (!this.closing) await this.audio.play()
  }
  async pause(): Promise<void> {
    this.audio.pause()
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.audio.pause()
    this.audio.removeEventListener('ended', this.onEnded)
    this.audio.removeEventListener('error', this.onError)
    this.audio.removeAttribute('src')
    this.audio.load()
    return (this.closing = this.spectrum?.dispose() ?? Promise.resolve())
  }
  private readonly onEnded = (): void => {
    this.dispatchEvent(new Event('ended'))
  }
  private readonly onError = (): void => {
    this.dispatchEvent(new Event('error'))
  }
}
