import { SPEECH_TEXT_STREAM_LIMIT, type SpeechTextEvent } from '@shared/ai/voice'

import { VoiceRuntimeError } from './VoiceRuntimeError'

/** One acknowledged handoff prevents IPC producers from outrunning inference. */
export class VoiceTextInput implements AsyncIterable<SpeechTextEvent> {
  private pending?: { event: SpeechTextEvent; resolve: () => void; reject: (error: unknown) => void }
  private wake?: () => void
  private sequence = 0
  private characters: number
  private ended = false
  private failure?: unknown

  constructor(private readonly initialText: string) {
    this.characters = initialText.length
    if (!this.characters || this.characters > SPEECH_TEXT_STREAM_LIMIT) throw new VoiceRuntimeError('invalid_request')
  }

  write(sequence: number, event: SpeechTextEvent): Promise<void> {
    if (this.failure) return Promise.reject(this.failure)
    if (this.ended || this.pending || sequence !== this.sequence)
      return Promise.reject(new VoiceRuntimeError('invalid_request'))
    if (event.type === 'text') {
      if (
        !event.text.length ||
        event.text.length > 2048 ||
        this.characters + event.text.length > SPEECH_TEXT_STREAM_LIMIT
      )
        return Promise.reject(new VoiceRuntimeError('invalid_request'))
      this.characters += event.text.length
    }
    this.sequence++
    return new Promise((resolve, reject) => {
      this.pending = { event, resolve, reject }
      this.wake?.()
    })
  }

  finish(sequence: number): void {
    if (this.failure) throw this.failure
    if (this.pending || this.ended || sequence !== this.sequence) throw new VoiceRuntimeError('invalid_request')
    this.ended = true
    this.wake?.()
  }

  close(error: unknown = new VoiceRuntimeError('aborted')): void {
    this.failure = error
    this.pending?.reject(error)
    this.pending = undefined
    this.wake?.()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SpeechTextEvent> {
    if (this.failure) throw this.failure
    yield { type: 'text', text: this.initialText }
    yield { type: 'flush' }
    while (true) {
      if (this.failure) throw this.failure
      if (this.pending) {
        const item = this.pending
        this.pending = undefined
        item.resolve()
        yield item.event
      } else if (this.ended) return
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve
        })
    }
  }
}
