import { randomUUID } from 'node:crypto'

import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent'

import {
  runtimeId,
  ThreadFeed,
  RuntimeMessageStream,
  type RuntimeMessage,
  type ItemRef,
  type Thread
} from '@cherrystudio/agent-runtime'

type PiMessage = AgentSession['messages'][number]
type PiContext = { message: PiMessage; id: string }[]

export class PiProjection {
  readonly feed: ThreadFeed
  private ids = new WeakMap<object, string>()
  private originals = new WeakMap<object, PiMessage>()
  private active = new Map<string, string>()
  private calls = new Map<string, string>()
  private snapshotMessages: RuntimeMessage[] | undefined
  private readonly readers = new Map<
    string,
    {
      reader: RuntimeMessageStream
      texts: Map<number, { index: number; text: string }>
    }
  >()
  private pending = Promise.resolve()
  private generation = 0
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
        messages: [],
        inputs: [],
        ...(children ? { delegations: [] } : {}),
        activity: { scope: 'foreground', state: session.isIdle ? 'idle' : 'active' }
      },
      report
    )
    this.bind(session)
    for (const message of session.messages) this.write(message, this.id(message), 'complete')
  }

  rebind(session: AgentSession): void {
    this.unsubscribe()
    this.generation++
    for (const { reader } of this.readers.values()) void reader.close()
    this.readers.clear()
    this.reset(session)
    this.bind(session)
  }

  private reset(session: AgentSession, context?: PiContext): void {
    this.session = session
    this.ids = new WeakMap()
    this.active.clear()
    this.calls.clear()
    this.feed.publish({ type: 'gap', reason: 'mapping-reset' })
    this.snapshotMessages = []
    for (const { message, id } of context ?? this.captureContext()) this.write(message, id, 'complete')
    this.feed.publish({
      ...this.feed.snapshot,
      messages: this.snapshotMessages,
      activity: { scope: 'foreground', state: session.isIdle ? 'idle' : 'active' }
    })
    this.snapshotMessages = undefined
  }

  private captureContext(): PiContext {
    return this.session.sessionManager
      .buildSessionProjection()
      .entries.flatMap(({ sourceEntry, messages }) =>
        messages.map((message) => ({ message: structuredClone(message), id: sourceEntry.id }))
      )
  }

  private bind(session: AgentSession): void {
    this.unsubscribe = session.subscribe((native) => {
      const event = structuredClone(native)
      if ('message' in native && 'message' in event) {
        const message = native.message
        const slot = message.role === 'toolResult' ? `tool:${message.toolCallId}` : message.role
        const id = native.type === 'message_start' ? this.id(message) : (this.active.get(slot) ?? this.id(message))
        this.ids.set(message, id)
        this.ids.set(event.message, id)
        this.originals.set(event.message, message)
        if (native.type === 'message_start') this.active.set(slot, id)
        if (native.type === 'message_end') this.active.delete(slot)
      }
      const context =
        event.type === 'entry_appended' &&
        (event.entry.type === 'custom_message' ||
          event.entry.type === 'context_edit' ||
          event.entry.type === 'compaction')
          ? this.captureContext()
          : undefined
      const generation = this.generation
      this.pending = this.pending
        .then(async () => {
          if (generation === this.generation) await this.event(event, context)
        })
        .catch((error) => {
          this.report(error)
          this.feed.publish({ type: 'gap', reason: 'disconnected' })
        })
    })
  }

  async close(): Promise<void> {
    this.unsubscribe()
    await this.pending
    for (const { reader } of this.readers.values()) await reader.close()
    this.readers.clear()
    this.feed.close('shutdown')
  }

  private id(message: PiMessage): string {
    const known = this.ids.get(message)
    if (known) return known
    const id = this.entryId(message) ?? `live:${randomUUID()}`
    this.ids.set(message, id)
    return id
  }

  private entryId(message: PiMessage): string | undefined {
    const entry = this.session.sessionManager
      .getBranch()
      .find((entry) => entry.type === 'message' && entry.message === message)
    if (entry) return entry.id
    const index = this.session.messages.indexOf(message)
    if (index < 0) return undefined
    // Pi rebuilds custom/context-edited messages from this ordered native projection.
    return this.session.sessionManager
      .buildSessionProjection()
      .entries.flatMap((entry) => entry.messages.map(() => entry.sourceEntry.id))[index]
  }

  private itemRef(id: string): ItemRef {
    return { session: this.ref, id: runtimeId(id) }
  }

  private publish(message: RuntimeMessage, replaces?: readonly ItemRef[]): void {
    if (this.snapshotMessages) {
      const index = this.snapshotMessages.findIndex((item) => item.id === message.id)
      if (index < 0) this.snapshotMessages.push(message)
      else this.snapshotMessages[index] = message
    } else this.feed.publish({ type: 'message.upsert', message, replaces })
  }

  private result(callId: string, output: unknown, isError: boolean, preliminary = false): void {
    const id = this.calls.get(callId)
    const message = (this.snapshotMessages ?? this.feed.snapshot.messages).find((message) => message.id === id)
    if (!message) return
    this.publish({
      ...message,
      parts: message.parts.map((part) => {
        if (part.type !== 'dynamic-tool' || part.toolCallId !== callId) return part
        const base = {
          type: 'dynamic-tool' as const,
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          input: part.input,
          callProviderMetadata: part.callProviderMetadata
        }
        if (!isError) return { ...base, state: 'output-available', output, preliminary }
        const content = (output as { content?: { type: string; text?: string }[] }).content
        return {
          ...base,
          state: 'output-error',
          errorText:
            content
              ?.filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n') ?? String(output),
          resultProviderMetadata: { pi: { result: JSON.parse(JSON.stringify(output)) } }
        }
      })
    })
  }

  private write(message: PiMessage, id: string, completeness: 'partial' | 'complete'): void {
    if (!('content' in message)) return
    if (message.role === 'toolResult') {
      this.result(message.toolCallId, { content: message.content, details: message.details }, message.isError)
      return
    }
    if (
      message.role !== 'user' &&
      message.role !== 'assistant' &&
      message.role !== 'system' &&
      !(message.role === 'custom' && message.display)
    )
      return
    const liveId = id
    if (completeness === 'complete' && !this.snapshotMessages) {
      const original = this.originals.get(message) ?? message
      const entryId = this.entryId(original)
      if (entryId) {
        id = entryId
        this.ids.set(message, id)
        this.ids.set(original, id)
      }
    }
    const value: RuntimeMessage = {
      id,
      role: message.role === 'custom' ? 'user' : message.role,
      parts: [],
      metadata: { completeness }
    }
    const state = completeness === 'complete' ? 'done' : 'streaming'
    if (typeof message.content === 'string') value.parts.push({ type: 'text', text: message.content, state })
    else
      for (const part of message.content) {
        if (part.type === 'text')
          value.parts.push({
            type: 'text',
            text: part.text,
            state,
            ...('textSignature' in part &&
              part.textSignature && { providerMetadata: { pi: { textSignature: part.textSignature } } })
          })
        if (part.type === 'thinking')
          value.parts.push({
            type: 'reasoning',
            text: part.thinking,
            state,
            ...(part.thinkingSignature && { providerMetadata: { pi: { thinkingSignature: part.thinkingSignature } } })
          })
        if (part.type === 'image')
          value.parts.push({ type: 'file', mediaType: part.mimeType, url: `data:${part.mimeType};base64,${part.data}` })
        if (part.type === 'toolCall') {
          this.calls.set(part.id, id)
          value.parts.push({
            type: 'dynamic-tool',
            toolCallId: part.id,
            toolName: part.name,
            state: completeness === 'complete' ? 'input-available' : 'input-streaming',
            input: part.arguments
          })
        }
      }
    this.publish(value, id === liveId ? undefined : [this.itemRef(liveId)])
  }

  private async delta(event: Extract<AgentSessionEvent, { type: 'message_update' }>, id: string): Promise<void> {
    const native = event.assistantMessageEvent
    const stream = this.readers.get(id)
    if (!stream || !('contentIndex' in native)) return
    const part = native.partial.content[native.contentIndex]
    const key = String(native.contentIndex)
    type Chunk = Parameters<RuntimeMessageStream['append']>[0][number]
    const chunks: Chunk[] = []
    if (native.type === 'text_start') chunks.push({ type: 'text-start', id: key })
    if (native.type === 'text_delta') chunks.push({ type: 'text-delta', id: key, delta: native.delta })
    if (native.type === 'text_end') chunks.push({ type: 'text-end', id: key })
    if (native.type === 'thinking_start') chunks.push({ type: 'reasoning-start', id: key })
    if (native.type === 'thinking_delta') chunks.push({ type: 'reasoning-delta', id: key, delta: native.delta })
    if (native.type === 'thinking_end') chunks.push({ type: 'reasoning-end', id: key })
    if (part?.type === 'toolCall') {
      this.calls.set(part.id, id)
      if (native.type === 'toolcall_start')
        chunks.push({ type: 'tool-input-start', toolCallId: part.id, toolName: part.name, dynamic: true })
      if (native.type === 'toolcall_delta')
        chunks.push({ type: 'tool-input-delta', toolCallId: part.id, inputTextDelta: native.delta })
      if (native.type === 'toolcall_end')
        chunks.push({
          type: 'tool-input-available',
          toolCallId: part.id,
          toolName: part.name,
          input: part.arguments,
          dynamic: true
        })
    }
    if (chunks.length) {
      const message = await stream.reader.append(chunks, 'partial')
      if (native.type === 'text_start' || native.type === 'thinking_start')
        stream.texts.set(native.contentIndex, { index: message.parts.length - 1, text: '' })
      const text = stream.texts.get(native.contentIndex)
      if (text) {
        // Native partials can run ahead of delta delivery; block-end content may also revise them.
        if (native.type === 'text_end' || native.type === 'thinking_end') text.text = native.content
        else if (part?.type === 'text') text.text = part.text
        else if (part?.type === 'thinking') text.text = part.thinking
      }
      const parts = message.parts.slice()
      for (const { index, text } of stream.texts.values()) {
        const part = parts[index]
        if (part.type === 'text' || part.type === 'reasoning') parts[index] = { ...part, text }
      }
      if (this.readers.get(id) === stream) this.publish({ ...message, parts })
    }
  }

  private async event(event: AgentSessionEvent, context?: PiContext): Promise<void> {
    if (
      (event.type === 'compaction_end' && event.result) ||
      (event.type === 'entry_appended' && (event.entry.type === 'compaction' || event.entry.type === 'context_edit'))
    )
      this.reset(this.session, context)
    if (event.type === 'entry_appended' && event.entry.type === 'custom_message') {
      for (const { message, id } of context ?? []) if (id === event.entry.id) this.write(message, id, 'complete')
    }
    if (event.type === 'message_start' || event.type === 'message_update' || event.type === 'message_end') {
      const message = event.message
      const id = this.id(message)
      if (event.type === 'message_start' && message.role === 'assistant')
        this.readers.set(id, { reader: new RuntimeMessageStream(id), texts: new Map() })
      if (event.type === 'message_update') await this.delta(event, id)
      else this.write(message, id, event.type === 'message_end' ? 'complete' : 'partial')
      if (event.type === 'message_end') {
        await this.readers.get(id)?.reader.close()
        this.readers.delete(id)
      }
    }
    if (event.type === 'tool_execution_update') this.result(event.toolCallId, event.partialResult, false, true)
    if (event.type === 'agent_start' || event.type === 'agent_settled') {
      this.feed.publish({
        type: 'activity.changed',
        activity: { scope: 'foreground', state: event.type === 'agent_start' ? 'active' : 'idle' }
      })
    }
  }
}
