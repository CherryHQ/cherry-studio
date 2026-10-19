import { randomUUID } from 'node:crypto'

import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent'

import {
  runtimeId,
  ThreadFeed,
  type ContentItem,
  type ContentPart,
  type InputId,
  type InputState,
  type ItemRef,
  type Thread
} from '@cherrystudio/agent-runtime'

type PiMessage = AgentSession['messages'][number]

export class PiProjection {
  readonly feed: ThreadFeed
  private ids = new WeakMap<object, string>()
  private inputIds = new WeakMap<object, InputId>()
  private active = new Map<string, string>()
  private calls = new Map<string, ItemRef>()
  private unsubscribe: () => void = () => {}

  constructor(
    readonly ref: Thread,
    private session: AgentSession,
    private readonly report: (error: unknown) => void,
    children: boolean
  ) {
    this.feed = new ThreadFeed(
      {
        type: 'snapshot',
        coverage: 'current-view',
        items: [],
        inputs: [],
        ...(children ? { subagents: [] } : {}),
        activity: { scope: 'foreground', state: session.isIdle ? 'idle' : 'active' }
      },
      report
    )
    this.bind(session)
    for (const message of session.messages) this.write(message, this.id(message), 'complete')
  }

  rebind(session: AgentSession): void {
    this.unsubscribe()
    this.reset(session)
    this.bind(session)
  }

  private reset(session: AgentSession): void {
    this.session = session
    this.ids = new WeakMap()
    this.inputIds = new WeakMap()
    this.active.clear()
    this.calls.clear()
    this.feed.publish({ type: 'gap', reason: 'mapping-reset' })
    this.feed.publish({
      ...this.feed.snapshot,
      items: [],
      activity: { scope: 'foreground', state: session.isIdle ? 'idle' : 'active' }
    })
    for (const message of session.messages) this.write(message, this.id(message), 'complete')
  }

  private bind(session: AgentSession): void {
    this.unsubscribe = session.subscribe((event) => {
      try {
        this.event(event)
      } catch (error) {
        this.report(error)
        this.feed.publish({ type: 'gap', reason: 'mapping-reset' })
      }
    })
  }

  close(): void {
    this.unsubscribe()
    this.feed.close('shutdown')
  }

  recordInput(input: InputState & { readonly inputId: InputId }): void {
    const previous = this.feed.snapshot.inputs.find((known) => known.inputId === input.inputId)
    this.feed.publish({
      type: 'input.changed',
      input: { ...previous, ...input, facts: [...new Set([...(previous?.facts ?? []), ...input.facts])] }
    })
  }

  private id(message: PiMessage): string {
    const known = this.ids.get(message)
    if (known) return known
    const id = `live:${randomUUID()}`
    this.ids.set(message, id)
    return id
  }

  private itemRef(id: string): ItemRef {
    return { session: this.ref, id: runtimeId(id) }
  }

  private write(message: PiMessage, id: string, completeness: 'partial' | 'complete'): void {
    if (!('content' in message)) return
    const parts: ContentPart[] = []
    const items: ContentItem[] = []
    if (typeof message.content === 'string') parts.push({ type: 'text', text: message.content })
    else
      for (const part of message.content) {
        if (part.type === 'text') parts.push({ type: 'text', text: part.text })
        if (part.type === 'thinking') parts.push({ type: 'reasoning', text: part.thinking })
        if (part.type === 'toolCall') {
          const ref = this.itemRef(`${id}:call:${part.id}`)
          this.calls.set(part.id, ref)
          items.push({
            ref,
            type: 'tool-call',
            name: part.name,
            argumentsText: JSON.stringify(part.arguments),
            completeness
          })
        }
      }
    if (message.role === 'toolResult') {
      items.push({
        ref: this.itemRef(id),
        type: 'tool-result',
        call: this.calls.get(message.toolCallId),
        parts,
        outcome: message.isError ? 'error' : 'success'
      })
    } else if (message.role === 'user' || message.role === 'assistant' || message.role === 'system') {
      const inputId = this.inputIds.get(message)
      items.unshift({
        ref: this.itemRef(id),
        type: 'message',
        role: message.role,
        parts,
        completeness,
        ...(inputId === undefined ? {} : { inputId })
      })
    } else if (message.role === 'custom' && message.display) {
      const inputId = this.inputIds.get(message)
      items.push({
        ref: this.itemRef(id),
        type: 'message',
        role: 'user',
        parts,
        completeness,
        ...(inputId === undefined ? {} : { inputId })
      })
    }
    for (const item of items) this.feed.publish({ type: 'item.upsert', item })
  }

  private event(event: AgentSessionEvent): void {
    if (event.type === 'input_placed') {
      const inputId = runtimeId<'input'>(event.inputId)
      this.inputIds.set(event.message, inputId)
      this.write(event.message, this.id(event.message), 'complete')
      this.recordInput({ inputId, facts: ['placed'] })
    }
    if (event.type === 'input_handled') {
      this.recordInput({
        inputId: runtimeId(event.inputId),
        facts: ['locally-handled'],
        ...(event.errorMessage === undefined
          ? {}
          : {
              outcome: 'failed',
              error: { operation: 'input', code: 'command-failed', message: event.errorMessage }
            })
      })
    }
    if (event.type === 'compaction_end' && event.result) this.reset(this.session)
    if (event.type === 'message_start' || event.type === 'message_update' || event.type === 'message_end') {
      const message = event.message
      const slot = message.role === 'toolResult' ? `tool:${message.toolCallId}` : message.role
      const id = event.type === 'message_start' ? this.id(message) : (this.active.get(slot) ?? this.id(message))
      this.ids.set(message, id)
      this.active.set(slot, id)
      this.write(message, id, event.type === 'message_end' ? 'complete' : 'partial')
      if (event.type === 'message_end') this.active.delete(slot)
    }
    if (event.type === 'agent_start' || event.type === 'agent_settled') {
      this.feed.publish({
        type: 'activity.changed',
        activity: { scope: 'foreground', state: event.type === 'agent_start' ? 'active' : 'idle' }
      })
    }
  }
}
