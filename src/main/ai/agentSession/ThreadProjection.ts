import type { ContentItem, ObservationPayload } from '@cherrystudio/agent-runtime'
import type { CherryUIMessageChunk } from '@shared/data/types/message'

/** Projects live content; native snapshots establish a baseline without replaying the product archive. */
export class ThreadProjection {
  private readonly items = new Map<string, ContentItem>()
  private readonly ended = new Set<string>()

  constructor(
    private readonly emit: (chunk: CherryUIMessageChunk) => void,
    private readonly tool: (item: Exclude<ContentItem, { type: 'message' }>) => void
  ) {}

  accept(event: ObservationPayload): void {
    if (event.type === 'snapshot') {
      this.items.clear()
      this.ended.clear()
      for (const item of event.items) {
        this.items.set(item.ref.id, item)
        this.ended.add(item.ref.id)
      }
      return
    }
    if (event.type !== 'item.upsert') return
    const item = event.item
    const previous = this.items.get(item.ref.id)
    this.items.set(item.ref.id, item)
    if (this.ended.has(item.ref.id)) return
    if (item.type !== 'message') {
      if (item.type === 'tool-result' || item.completeness === 'complete') {
        this.tool(item)
        this.ended.add(item.ref.id)
      }
      return
    }
    if (item.role !== 'assistant') return
    const prior = previous?.type === 'message' ? previous.parts : []
    for (const [index, part] of item.parts.entries()) {
      const id = `${item.ref.id}:${index}`
      const before = prior[index]
      if (before && (before.type !== part.type || !part.text.startsWith(before.text))) {
        throw new Error('Runtime replaced an already streamed content part')
      }
      if (!before) this.emit({ type: part.type === 'text' ? 'text-start' : 'reasoning-start', id })
      const delta = part.text.slice(before?.text.length ?? 0)
      if (delta) this.emit({ type: part.type === 'text' ? 'text-delta' : 'reasoning-delta', id, delta })
      if (item.completeness === 'complete') {
        this.emit({ type: part.type === 'text' ? 'text-end' : 'reasoning-end', id })
      }
    }
    if (item.completeness === 'complete') this.ended.add(item.ref.id)
  }
}
