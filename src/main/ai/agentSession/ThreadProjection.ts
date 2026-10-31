import { isDeepStrictEqual } from 'node:util'

import type { ObservationPayload, RuntimeMessage } from '@cherrystudio/agent-runtime'
import type { CherryUIMessageChunk } from '@shared/data/types/message'

/** Bridges observed messages to the desktop chunk consumer until message-source adoption. */
export class ThreadProjection {
  private readonly messages = new Map<string, RuntimeMessage>()
  private readonly ids = new Map<string, string>()
  private readonly baseline = new Set<string>()
  private readonly ended = new Set<string>()
  private readonly text = new Map<string, { type: string; text: string }>()

  constructor(
    private readonly emit: (chunk: CherryUIMessageChunk) => void,
    private readonly tool: (part: Extract<RuntimeMessage['parts'][number], { type: 'dynamic-tool' }>) => void
  ) {}

  accept(event: ObservationPayload): void {
    if (event.type === 'snapshot') {
      this.messages.clear()
      this.ids.clear()
      this.baseline.clear()
      this.ended.clear()
      this.text.clear()
      for (const message of event.messages) {
        this.messages.set(message.id, message)
        this.baseline.add(message.id)
      }
      return
    }
    if (event.type !== 'message.upsert') return
    const message = event.message
    const source =
      this.ids.get(message.id) ??
      event.replaces?.map((ref) => this.ids.get(ref.id) ?? ref.id).find((id) => this.messages.has(id)) ??
      message.id
    const previous = this.messages.get(source)
    this.ids.set(message.id, source)
    for (const ref of event.replaces ?? []) this.ids.set(ref.id, source)
    this.messages.set(source, message)
    if (this.baseline.has(source) || message.role !== 'assistant') return
    for (const [index, part] of message.parts.entries()) {
      const id = `${source}:${index}`
      const before = previous?.parts[index]
      if (part.type === 'dynamic-tool') {
        if (part.state !== 'input-streaming' && !isDeepStrictEqual(before, part)) this.tool(part)
        continue
      }
      if (this.ended.has(id)) continue
      if (part.type === 'file' || part.type === 'source-url' || part.type === 'source-document') {
        this.emit(part)
        this.ended.add(id)
        continue
      }
      if (part.type !== 'text' && part.type !== 'reasoning') continue
      const sent = this.text.get(id)
      // Native start snapshots can already contain text whose deltas arrive afterward.
      if (sent?.type === part.type && sent.text.length > part.text.length && sent.text.startsWith(part.text)) continue
      if (sent && (sent.type !== part.type || !part.text.startsWith(sent.text)))
        throw new Error('Runtime replaced an already streamed content part')
      if (!sent)
        this.emit({
          type: part.type === 'text' ? 'text-start' : 'reasoning-start',
          id,
          providerMetadata: part.providerMetadata
        })
      const delta = part.text.slice(sent?.text.length ?? 0)
      if (delta) this.emit({ type: part.type === 'text' ? 'text-delta' : 'reasoning-delta', id, delta })
      this.text.set(id, { type: part.type, text: part.text })
      if (part.state === 'done' || message.metadata?.completeness === 'complete') {
        this.emit({
          type: part.type === 'text' ? 'text-end' : 'reasoning-end',
          id,
          providerMetadata: part.providerMetadata
        })
        this.ended.add(id)
      }
    }
  }
}
