import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import {
  cloneObservationValue,
  type LivePartInput,
  type ProjectionEvents,
  type RuntimeMessage,
  type Thread
} from '@cherrystudio/agent-runtime'
import type { RuntimeMessageProjection } from '@main/ai/runtime/types'
import type { CherryUIMessage } from '@shared/data/types/message'

import { type MessageDecorator, projectRuntimeMessage } from './ThreadMessageProjection'

/** Converts root recovery sources without keeping a second native or display transcript. */
export class ThreadProjection {
  private seen = new Map<string, WeakRef<RuntimeMessage>>()
  private hasGap = false

  constructor(
    private readonly thread: Thread,
    private readonly contextId: string,
    private readonly emit: (projection: RuntimeMessageProjection) => void,
    private readonly decorate?: MessageDecorator
  ) {}

  accept(batch: {
    readonly events: Exclude<ProjectionEvents, readonly LivePartInput[]>
    readonly live: readonly string[]
    readonly aliases: Readonly<Record<string, string>>
  }): void {
    const messages = new Map<string, CherryUIMessage>()
    const inputs: Record<string, string> = {}
    const replaces = Object.fromEntries(Object.entries(batch.aliases).map(([committed, live]) => [live, committed]))
    const removed: string[] = []
    const project = (source: RuntimeMessage, before?: RuntimeMessage): void => {
      if (source.role === 'user' && source.metadata?.inputId) inputs[source.id] = source.metadata.inputId
      if (before && (before === source || isDeepStrictEqual(before, source))) return
      const parts = cloneObservationValue(source.parts) as CherryUIMessage['parts']
      messages.set(source.id, projectRuntimeMessage(source, parts, this.decorate))
    }
    for (const event of batch.events) {
      if (event.type === 'snapshot') {
        const previous = this.seen
        for (const message of event.messages) project(message, previous.get(message.id)?.deref())
        this.seen = new Map(event.messages.map((message) => [message.id, new WeakRef(message)]))
        this.hasGap = false
      } else if (event.type === 'message.reconcile' && !this.hasGap) {
        const { message } = event
        project(message, this.seen.get(message.id)?.deref())
        this.seen.set(message.id, new WeakRef(message))
        for (const ref of event.replaces ?? []) {
          this.assertThread(ref.session)
          replaces[ref.id] = message.id
          if (ref.id !== message.id) {
            this.seen.delete(ref.id)
            messages.delete(ref.id)
          }
        }
      } else if (event.type === 'message.remove') {
        this.assertThread(event.ref.session)
        this.seen.delete(event.ref.id)
        messages.delete(event.ref.id)
        removed.push(event.ref.id)
      } else if (event.type === 'gap' || event.type === 'closed') this.hasGap = true
    }
    const live = new Set(batch.live)
    this.emit({
      contextId: this.contextId,
      messages: [...messages.values()],
      ...(Object.keys(inputs).length > 0 && { inputs }),
      live: [...messages.keys()].filter((id) => live.has(id)),
      replaces,
      removed
    })
  }

  acceptPart(event: LivePartInput, live: readonly string[]): boolean {
    this.assertThread(event.ref.session)
    if (this.hasGap || !live.includes(event.ref.id)) return false
    this.seen.delete(event.ref.id)
    return true
  }

  private assertThread(thread: Thread): void {
    if (thread.backendId !== this.thread.backendId || thread.id !== this.thread.id)
      throw new Error('Observation belongs to a different thread')
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
