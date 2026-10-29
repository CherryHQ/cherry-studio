import { randomUUID } from 'node:crypto'

import type { ObservationPayload, Thread } from '@cherrystudio/agent-runtime'
import type { RuntimeMessageProjection } from '@main/ai/runtime/types'

import { ThreadMessageProjection, type MessageDecorator } from './ThreadMessageProjection'

/** Root observation uses the same materialized message view as child observation. */
export class ThreadProjection {
  private readonly view: ThreadMessageProjection

  constructor(
    thread: Thread,
    private readonly contextId: string,
    private readonly emit: (projection: RuntimeMessageProjection) => void,
    decorate?: MessageDecorator
  ) {
    this.view = new ThreadMessageProjection(thread, decorate)
  }

  async accept(
    event: ObservationPayload,
    liveSnapshot = false,
    aliases: Readonly<Record<string, string>> = {}
  ): Promise<void> {
    const before = new Map(this.view.snapshot().messages.map((message) => [message.id, message]))
    await this.view.accept(event)
    const messages = this.view.snapshot().messages
    this.emit({
      contextId: this.contextId,
      messages,
      live:
        event.type !== 'snapshot' || liveSnapshot
          ? messages.filter((message) => before.get(message.id) !== message).map((message) => message.id)
          : [],
      replaces: {
        ...Object.fromEntries(Object.entries(aliases).map(([committed, live]) => [live, committed])),
        ...(event.type === 'message.upsert' &&
          Object.fromEntries((event.replaces ?? []).map((ref) => [ref.id, event.message.id])))
      },
      removed: event.type === 'message.remove' ? [event.ref.id] : []
    })
  }

  close(): Promise<void> {
    return this.view.close()
  }

  /** Local command replies belong to the product message, outside native model history. */
  notice(text: string): void {
    const id = `notice:${randomUUID()}`
    this.emit({
      contextId: this.contextId,
      messages: [{ id, role: 'assistant', parts: [{ type: 'text', text, state: 'done' }] }],
      live: [id],
      replaces: {},
      removed: []
    })
  }
}
