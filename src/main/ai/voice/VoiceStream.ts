import type { SpeechPcmChunk, SpeechPcmFormat, SpeechStreamEvent, SpeechStreamIdentity } from '@shared/ai/voice'

import { VoiceRuntimeError } from './VoiceRuntimeError'

/** One playback attempt. Credits count consumed source frames, including during pause/resume. */
export class VoiceStream {
  readonly capacityFrames: number
  private attached = false
  private sent = 0
  private consumed = 0
  private ended = false
  private wake?: () => void
  private readonly controller = new AbortController()
  private readonly lifetime: AbortSignal
  private readonly attachmentTimer: ReturnType<typeof setTimeout>
  private readonly retentionTimer: ReturnType<typeof setTimeout>

  constructor(
    readonly identity: SpeechStreamIdentity,
    readonly format: SpeechPcmFormat,
    signal: AbortSignal,
    private readonly send: (event: SpeechStreamEvent) => void,
    onExpired: () => void
  ) {
    if (
      !Number.isInteger(format.sampleRate) ||
      format.sampleRate < 8000 ||
      format.sampleRate > 192000 ||
      ![1, 2].includes(format.channels)
    )
      throw new VoiceRuntimeError('invalid_audio')
    this.capacityFrames = format.sampleRate
    this.lifetime = AbortSignal.any([signal, this.controller.signal])
    this.lifetime.addEventListener('abort', this.onAbort, { once: true })
    this.attachmentTimer = setTimeout(() => this.close('timeout'), 15_000)
    this.retentionTimer = setTimeout(() => {
      this.close('timeout')
      onExpired()
    }, 15 * 60_000)
    this.attachmentTimer.unref()
    this.retentionTimer.unref()
  }

  attach(): void {
    this.lifetime.throwIfAborted()
    this.attached = true
    clearTimeout(this.attachmentTimer)
    this.wake?.()
  }

  acknowledge(frames: number): void {
    if (!this.attached || !Number.isSafeInteger(frames) || frames < 0 || frames > this.sent)
      throw new VoiceRuntimeError('invalid_request')
    if (frames <= this.consumed) return
    this.consumed = frames
    this.wake?.()
  }

  get drained(): boolean {
    return this.ended && this.consumed === this.sent
  }

  async relay(chunks: AsyncIterable<SpeechPcmChunk>, completed: Promise<void>): Promise<void> {
    const iterator = chunks[Symbol.asyncIterator]()
    try {
      await this.waitUntil(() => this.attached)
      while (true) {
        // Do not count deliberate downstream backpressure as a producer stall.
        await this.waitUntil(() => this.sent - this.consumed < this.capacityFrames)
        const item = await this.next(iterator)
        if (item.done) break
        const { samples, startFrame } = item.value
        const frames = samples.length / this.format.channels
        if (
          startFrame !== this.sent ||
          !Number.isSafeInteger(frames) ||
          frames < 1 ||
          frames > 4096 ||
          !samples.every(Number.isFinite)
        )
          throw new VoiceRuntimeError('invalid_audio')
        await this.waitUntil(() => this.sent - this.consumed + frames <= this.capacityFrames)
        this.sent += frames
        this.send({ ...this.identity, type: 'pcm', chunk: item.value })
      }
      await completed
      this.lifetime.throwIfAborted()
      if (!this.sent) throw new VoiceRuntimeError('invalid_audio')
      this.ended = true
      this.send({ ...this.identity, type: 'end', frames: this.sent })
    } finally {
      clearTimeout(this.attachmentTimer)
    }
  }

  close(reason: 'aborted' | 'timeout' = 'aborted'): void {
    this.controller.abort(new VoiceRuntimeError(reason))
    clearTimeout(this.attachmentTimer)
    clearTimeout(this.retentionTimer)
    this.lifetime.removeEventListener('abort', this.onAbort)
  }

  private readonly onAbort = (): void => {
    this.wake?.()
  }

  private async waitUntil(ready: () => boolean): Promise<void> {
    while (!ready()) {
      this.lifetime.throwIfAborted()
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
    }
    this.wake = undefined
    this.lifetime.throwIfAborted()
  }

  private async next(iterator: AsyncIterator<SpeechPcmChunk>): Promise<IteratorResult<SpeechPcmChunk>> {
    this.lifetime.throwIfAborted()
    let timer: ReturnType<typeof setTimeout> | undefined
    let aborted: () => void = () => undefined
    try {
      return await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          aborted = () => reject(this.lifetime.reason)
          this.lifetime.addEventListener('abort', aborted, { once: true })
          timer = setTimeout(() => reject(new VoiceRuntimeError('timeout')), 120_000)
          timer.unref()
        })
      ])
    } finally {
      clearTimeout(timer)
      this.lifetime.removeEventListener('abort', aborted)
    }
  }
}
