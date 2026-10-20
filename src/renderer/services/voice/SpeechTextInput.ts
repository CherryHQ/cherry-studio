import { SPEECH_TEXT_STREAM_LIMIT, type SpeechTextEvent } from '@shared/ai/voice'

import { VoiceDomainError } from './VoiceService'

/** Bounded pending text; cancellation wakes a player waiting for the next snapshot. */
export class SpeechTextInput implements AsyncIterable<SpeechTextEvent> {
  private readonly closing = Promise.withResolvers<void>()
  readonly closed = this.closing.promise
  private readonly events: SpeechTextEvent[] = []
  private characters = 0
  private wake?: () => void
  private ended = false
  private cancelled = false

  push(text: string): void {
    if (this.ended || this.cancelled) throw new VoiceDomainError('aborted')
    if (this.characters + text.length > SPEECH_TEXT_STREAM_LIMIT) throw new RangeError('Speech text backlog exceeded')
    const events: SpeechTextEvent[] = []
    let offset = 0
    while (offset < text.length) {
      let end = Math.min(offset + 2048, text.length)
      if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--
      events.push({ type: 'text', text: text.slice(offset, end) })
      offset = end
    }
    events.push({ type: 'flush' })
    if (this.events.length + events.length > 64) throw new RangeError('Speech text backlog exceeded')
    this.characters += text.length
    this.events.push(...events)
    this.wake?.()
  }

  finish(): void {
    this.ended = true
    this.wake?.()
  }
  cancel(): void {
    this.cancelled = true
    this.closing.resolve()
    this.events.length = 0
    this.characters = 0
    this.wake?.()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SpeechTextEvent> {
    while (!this.cancelled) {
      const event = this.events.shift()
      if (event) {
        if (event.type === 'text') this.characters -= event.text.length
        yield event
      } else if (this.ended) return
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve
        })
    }
    throw new VoiceDomainError('aborted')
  }
}
