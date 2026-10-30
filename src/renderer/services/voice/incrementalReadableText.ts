import { SPEECH_TEXT_STREAM_LIMIT } from '@shared/ai/voice'

import { normalizeReadableText, stableReadableTextEnd } from './readableText'
import { VoiceDomainError } from './VoiceService'

export class IncrementalReadableText {
  private committed = ''
  private characters = 0

  update(snapshot: string, final = false): string {
    if (!snapshot.startsWith(this.committed)) throw new VoiceDomainError('invalid_request')
    if (snapshot.length > 20_000) throw new RangeError('Speech text limit exceeded')
    const pending = snapshot.slice(this.committed.length)
    const end = final ? pending.length : stableReadableTextEnd(pending)
    const normalized = normalizeReadableText(pending.slice(0, end))
    const text = normalized && this.characters ? `\n${normalized}` : normalized
    if (this.characters + text.length > SPEECH_TEXT_STREAM_LIMIT) throw new RangeError('Speech text limit exceeded')
    this.committed += pending.slice(0, end)
    this.characters += text.length
    return text
  }
}
