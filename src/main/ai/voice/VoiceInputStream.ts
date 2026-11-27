import type { SpeechPcmChunk } from '@shared/ai/voice'

import { VoiceRuntimeError } from './VoiceRuntimeError'

/** A single bounded handoff; a write acknowledges consumption, not inference completion. */
export class VoiceInputStream implements AsyncIterable<SpeechPcmChunk> {
  private pending?: { chunk: SpeechPcmChunk; resolve: () => void; reject: (error: unknown) => void }
  private wake?: () => void
  private frames = 0
  private ended = false
  private failure?: unknown

  write(chunk: SpeechPcmChunk): Promise<void> {
    if (this.failure) return Promise.reject(this.failure)
    if (this.ended || this.pending) return Promise.reject(new VoiceRuntimeError('invalid_request'))
    if (
      chunk.startFrame !== this.frames ||
      !chunk.samples.length ||
      chunk.samples.length > 1600 ||
      !chunk.samples.every(Number.isFinite) ||
      this.frames + chunk.samples.length > 16000 * 300
    )
      return Promise.reject(new VoiceRuntimeError('invalid_audio'))
    this.frames += chunk.samples.length
    return new Promise((resolve, reject) => {
      this.pending = { chunk, resolve, reject }
      this.wake?.()
    })
  }

  finish(frames: number): void {
    if (this.failure) throw this.failure
    if (this.pending || frames !== this.frames || !frames) throw new VoiceRuntimeError('invalid_request')
    this.ended = true
    this.wake?.()
  }

  close(error: unknown = new VoiceRuntimeError('aborted')): void {
    this.failure = error
    this.pending?.reject(error)
    this.pending = undefined
    this.wake?.()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SpeechPcmChunk> {
    while (true) {
      if (this.failure) throw this.failure
      if (this.pending) {
        const item = this.pending
        this.pending = undefined
        item.resolve()
        yield item.chunk
      } else if (this.ended) return
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve
        })
    }
  }
}
