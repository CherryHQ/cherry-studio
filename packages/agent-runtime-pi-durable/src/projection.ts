import { randomUUID } from 'node:crypto'

import type { Message } from '@earendil-works/pi-ai'
import type { ConversationView, ConversationWatch, LiveState } from '@earendil-works/pi-durable'

import {
  runtimeId,
  ThreadFeed,
  type ContentItem,
  type ContentPart,
  type ItemRef,
  type Thread
} from '@cherrystudio/agent-runtime'

/** One normalized source shared by every access to a native conversation. */
export class DurableProjection {
  readonly feed: ThreadFeed
  private readonly epoch = randomUUID()
  private transientIds = new Set<string>()

  constructor(
    readonly ref: Thread,
    private readonly watch: ConversationWatch,
    report: (error: unknown) => void
  ) {
    this.feed = new ThreadFeed(
      {
        type: 'snapshot',
        coverage: 'current-view',
        items: [],
        inputs: [],
        subagents: [],
        activity: { scope: 'foreground', state: 'unknown' }
      },
      report
    )
    this.update(watch.value)
    watch.start(async (value) => this.update(value))
    void watch.closed.then((end) => {
      if (end.reason === 'stopped' || end.reason === 'session_closed') return
      if ('error' in end) report(end.error)
      this.feed.publish({ type: 'gap', reason: 'disconnected' })
      this.feed.close('source-lost')
    })
  }

  async close(): Promise<void> {
    this.feed.close('shutdown')
    await this.watch.stop()
  }

  private update(view: ConversationView): void {
    const live = view.docs['pi.live'] as LiveState | undefined
    const items: ContentItem[] = []
    const transientIds = new Set<string>()
    const calls = new Map<string, ItemRef>()
    const itemRef = (id: string): ItemRef => ({ session: this.ref, id: runtimeId(id) })
    const append = (message: Message, id: string, completeness: 'partial' | 'complete') => {
      const parts: ContentPart[] = []
      const toolCalls: ContentItem[] = []
      if (typeof message.content === 'string') parts.push({ type: 'text', text: message.content })
      else
        for (const part of message.content) {
          if (part.type === 'text') parts.push({ type: 'text', text: part.text })
          if (part.type === 'thinking') parts.push({ type: 'reasoning', text: part.thinking })
          if (part.type === 'toolCall') {
            const ref = itemRef(`${id}:call:${part.id}`)
            calls.set(part.id, ref)
            toolCalls.push({
              ref,
              type: 'tool-call',
              name: part.name,
              argumentsText: JSON.stringify(part.arguments),
              completeness
            })
          }
        }
      if (message.role === 'toolResult')
        items.push({
          ref: itemRef(id),
          type: 'tool-result',
          call: calls.get(message.toolCallId),
          parts,
          outcome: message.isError ? 'error' : 'success'
        })
      else items.push({ ref: itemRef(id), type: 'message', role: message.role, parts, completeness })
      items.push(...toolCalls)
    }
    for (const entry of view.entries) {
      entry.model?.forEach((message, index) => append(message, `entry:${entry.id}:${index}`, 'complete'))
    }
    const generation = live?.generation
    const nextLiveId =
      generation?.message && live?.run
        ? `live:${this.epoch}:${live.run.taskId}:${generation.attempt}:${view.entries.at(-1)?.id ?? 0}`
        : undefined
    if (generation?.message && nextLiveId) {
      transientIds.add(nextLiveId)
      append(generation.message, nextLiveId, 'partial')
    }
    for (const slot of live?.tools ?? []) {
      if (slot.output !== undefined && slot.taskId && !slot.entry) {
        const id = `tool-progress:${this.epoch}:${slot.taskId}`
        transientIds.add(id)
        items.push({
          ref: itemRef(id),
          type: 'tool-result',
          call: calls.get(slot.callId),
          parts: [{ type: 'text', text: slot.output }],
          outcome: 'unknown'
        })
      }
    }
    if ([...this.transientIds].some((id) => !transientIds.has(id)))
      this.feed.publish({ type: 'gap', reason: 'mapping-reset' })
    this.transientIds = transientIds
    this.feed.publish({
      ...this.feed.snapshot,
      items,
      activity: { scope: 'foreground', state: live?.run ? 'active' : 'idle' }
    })
  }
}
