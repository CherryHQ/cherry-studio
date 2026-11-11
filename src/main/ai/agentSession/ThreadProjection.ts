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

  async accept(batch: {
    readonly events: readonly ObservationPayload[]
    readonly live: readonly string[]
    readonly aliases: Readonly<Record<string, string>>
  }): Promise<void> {
    const changed = await this.view.accept(batch.events)
    this.emit({
      contextId: this.contextId,
      messages: changed,
      live: changed.filter((message) => batch.live.includes(message.id)).map((message) => message.id),
      replaces: {
        ...Object.fromEntries(Object.entries(batch.aliases).map(([committed, live]) => [live, committed])),
        ...Object.fromEntries(
          batch.events.flatMap((event) =>
            event.type === 'message.upsert' ? (event.replaces ?? []).map((ref) => [ref.id, event.message.id]) : []
          )
        )
      },
      removed: batch.events.flatMap((event) => (event.type === 'message.remove' ? [event.ref.id] : []))
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
