import { randomUUID } from 'node:crypto'

import type {
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SessionMessage,
  SessionStoreEntry
} from '@anthropic-ai/claude-agent-sdk'

import {
  runtimeId,
  RuntimeMessageStream,
  type RuntimeMessage,
  type InputId,
  type ItemRef,
  type ObservationPayload,
  type Thread
} from '@cherrystudio/agent-runtime'

import { ClaudeFeed } from './observation'
import type { ClaudeArchive, ClaudeNativeMessage, ClaudeSource } from './types'

type Part = RuntimeMessage['parts'][number]
type ToolPart = Extract<Part, { type: 'dynamic-tool' }>
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value))

/** Native blocks retain their order; native result messages update the originating tool part. */
function contentPart(block: Record<string, unknown>, partial: boolean): Part | undefined {
  const state = partial ? 'streaming' : 'done'
  if (block.type === 'text' && typeof block.text === 'string')
    return {
      type: 'text',
      text: block.text,
      state,
      ...(block.citations !== undefined && { providerMetadata: { anthropic: { citations: json(block.citations) } } })
    }
  if (block.type === 'thinking' && typeof block.thinking === 'string')
    return {
      type: 'reasoning',
      text: block.thinking,
      state,
      ...(typeof block.signature === 'string' && { providerMetadata: { anthropic: { signature: block.signature } } })
    }
  if (block.type === 'redacted_thinking' && typeof block.data === 'string')
    return { type: 'reasoning', text: '', state, providerMetadata: { anthropic: { redactedData: block.data } } }
  if (block.type === 'image' || block.type === 'document') {
    const source = object(block.source)
    if (!source) return undefined
    const mediaType =
      typeof source.media_type === 'string' ? source.media_type : block.type === 'image' ? 'image/*' : 'application/pdf'
    if (source.type === 'url' && typeof source.url === 'string') return { type: 'file', mediaType, url: source.url }
    if (source.type === 'base64' && typeof source.data === 'string')
      return { type: 'file', mediaType, url: `data:${mediaType};base64,${source.data}` }
    if (source.type === 'text' && typeof source.data === 'string')
      return { type: 'file', mediaType, url: `data:${mediaType};base64,${Buffer.from(source.data).toString('base64')}` }
  }
  if (
    (block.type === 'tool_use' || block.type === 'mcp_tool_use' || block.type === 'server_tool_use') &&
    typeof block.id === 'string' &&
    typeof block.name === 'string'
  )
    return {
      type: 'dynamic-tool',
      toolCallId: block.id,
      toolName: block.name,
      input: block.input ?? {},
      state: partial ? 'input-streaming' : 'input-available',
      callProviderMetadata: {
        anthropic: { type: block.type, ...(typeof block.server_name === 'string' && { serverName: block.server_name }) }
      }
    }
  return undefined
}

export class ClaudeProjection {
  readonly feed: ClaudeFeed
  readonly retracted = new Set<string>()
  private readonly sources = new Map<string, ClaudeSource[]>()
  private readonly legacy: Record<string, { messageId: string; parts: number[] }> = {}
  private readonly messages = new Map<string, RuntimeMessage>()
  private readonly calls = new Map<string, { id: string; part: ToolPart }>()
  private readonly results = new Map<string, Set<string>>()
  private readonly aborted = new Set<string>()
  private stream?: {
    apiId: string
    id: string
    reader: RuntimeMessageStream
    blocks: Map<number, { part: number; type: string; callId?: string; bound?: string; stopped: boolean }>
    message?: RuntimeMessage
  }

  constructor(
    readonly thread: Thread,
    report: (error: unknown) => void
  ) {
    this.feed = new ClaudeFeed(report)
  }

  ref(uuid: string): ItemRef {
    return { session: this.thread, id: runtimeId(uuid) }
  }

  private upsert(message: RuntimeMessage, replaces?: readonly ItemRef[]): ObservationPayload {
    for (const ref of replaces ?? []) this.messages.delete(ref.id)
    this.messages.set(message.id, message)
    return { type: 'message.upsert', message, replaces }
  }

  remove(uuids: readonly string[]): ObservationPayload[] {
    const events: ObservationPayload[] = []
    for (const uuid of uuids) {
      this.retracted.add(uuid)
      this.feed.forget(uuid)
      for (const callId of this.results.get(uuid) ?? []) {
        const call = this.calls.get(callId)
        const owner = call && this.messages.get(call.id)
        if (owner && call)
          events.push(
            this.upsert({
              ...owner,
              parts: owner.parts.map((part) =>
                part.type === 'dynamic-tool' && part.toolCallId === callId ? call.part : part
              )
            })
          )
      }
      this.results.delete(uuid)
      if (this.messages.delete(uuid)) events.push({ type: 'message.remove', ref: this.ref(uuid) })
    }
    return events
  }

  message(
    message: SessionMessage | SDKAssistantMessage | { type: 'user'; uuid: string; message: unknown },
    options: { aborted?: boolean; inputId?: InputId; live?: boolean } = {}
  ): ObservationPayload[] {
    if (this.retracted.has(message.uuid)) return []
    if (options.aborted) this.aborted.add(message.uuid)
    const body = object(message.message)
    const content = typeof body?.content === 'string' ? [{ type: 'text', text: body.content }] : body?.content
    if (!Array.isArray(content)) return []
    const events: ObservationPayload[] = []
    const value: RuntimeMessage = {
      id: message.uuid,
      role: message.type,
      parts: [],
      metadata: { completeness: this.aborted.has(message.uuid) ? 'partial' : 'complete', inputId: options.inputId }
    }
    const sources: ClaudeSource[] = []
    const bound: number[] = []
    for (const [index, raw] of content.entries()) {
      const block = object(raw)
      if (!block) continue
      sources.push({ ref: this.ref(message.uuid), uuid: message.uuid, block: index })
      if (typeof block.tool_use_id === 'string') {
        const call = this.calls.get(block.tool_use_id)
        const owner = call && this.messages.get(call.id)
        if (!call || !owner) continue
        const output = block.content ?? ''
        const part = call.part
        const base = {
          type: 'dynamic-tool' as const,
          toolName: part.toolName,
          toolCallId: part.toolCallId,
          input: part.input,
          callProviderMetadata: part.callProviderMetadata
        }
        const result: ToolPart =
          block.is_error === true
            ? {
                ...base,
                state: 'output-error',
                errorText:
                  typeof output === 'string'
                    ? output
                    : Array.isArray(output)
                      ? output
                          .filter((part) => object(part)?.type === 'text')
                          .map((part) => object(part)?.text)
                          .join('\n')
                      : JSON.stringify(output),
                resultProviderMetadata: { anthropic: { result: json(output) } }
              }
            : { ...base, state: 'output-available', output }
        events.push(
          this.upsert({
            ...owner,
            parts: owner.parts.map((part) =>
              part.type === 'dynamic-tool' && part.toolCallId === block.tool_use_id ? result : part
            )
          })
        )
        const calls = this.results.get(message.uuid) ?? new Set<string>()
        calls.add(block.tool_use_id)
        this.results.set(message.uuid, calls)
        continue
      }
      let part = contentPart(block, this.aborted.has(message.uuid))
      if (!part) continue
      const provisional =
        options.live && this.stream?.apiId === body?.id
          ? [...this.stream!.blocks.entries()].find(
              ([, entry]) => !entry.bound && entry.type === block.type && (!entry.callId || entry.callId === block.id)
            )
          : undefined
      if (provisional) {
        provisional[1].bound = message.uuid
        bound.push(provisional[0])
        if (part.type === 'dynamic-tool' && !provisional[1].stopped)
          part = {
            type: 'dynamic-tool',
            toolName: part.toolName,
            toolCallId: part.toolCallId,
            input: part.input,
            callProviderMetadata: part.callProviderMetadata,
            state: 'input-streaming'
          }
      }
      if (part.type === 'dynamic-tool') {
        const callId = part.toolCallId
        const previous = this.messages
          .get(message.uuid)
          ?.parts.find((item) => item.type === 'dynamic-tool' && item.toolCallId === callId)
        this.calls.set(part.toolCallId, { id: message.uuid, part })
        if (previous?.type === 'dynamic-tool' && previous.state.startsWith('output-')) part = previous
      }
      this.legacy[`${message.uuid}:${index}`] = { messageId: message.uuid, parts: [value.parts.length] }
      value.parts.push(part)
    }
    this.sources.set(message.uuid, sources)
    if (value.parts.length || content.length === 0) {
      const replaces = bound.length && this.stream ? [this.ref(this.stream.id)] : undefined
      events.push(this.upsert(value, replaces))
      if (bound.length && this.stream) {
        this.stream.id = `live:${randomUUID()}`
        events.push(...this.preview())
      }
    }
    return events
  }

  result(message: SDKResultMessage): ObservationPayload[] {
    if (message.subtype !== 'success' || message.structured_output === undefined) return []
    return this.message({
      type: 'assistant',
      uuid: message.uuid,
      session_id: message.session_id,
      parent_tool_use_id: null,
      parent_agent_id: null,
      message: { content: [{ type: 'text', text: JSON.stringify(message.structured_output) }] }
    })
  }

  private preview(): ObservationPayload[] {
    if (!this.stream?.message) return []
    const indices = new Set([...this.stream.blocks.values()].filter((block) => !block.bound).map((block) => block.part))
    const parts = this.stream.message.parts.filter((_, index) => indices.has(index))
    if (!parts.length) return []
    const message = { ...this.stream.message, id: this.stream.id, parts }
    for (const part of parts)
      if (part.type === 'dynamic-tool') this.calls.set(part.toolCallId, { id: message.id, part })
    return [this.upsert(message)]
  }

  async partial(message: SDKPartialAssistantMessage): Promise<ObservationPayload[]> {
    const event = message.event
    if (event.type === 'message_start') {
      await this.stream?.reader.close()
      const id = `live:${randomUUID()}`
      this.stream = { apiId: event.message.id, id, reader: new RuntimeMessageStream(id), blocks: new Map() }
      return [{ type: 'activity.changed', activity: { scope: 'foreground', state: 'active' } }]
    }
    const stream = this.stream
    if (!stream || !('index' in event)) return []
    type Chunk = Parameters<RuntimeMessageStream['append']>[0][number]
    const chunks: Chunk[] = []
    const key = String(event.index)
    if (event.type === 'content_block_start') {
      const block = event.content_block
      const tool = block.type === 'tool_use' || block.type === 'mcp_tool_use' || block.type === 'server_tool_use'
      stream.blocks.set(event.index, {
        part: stream.message?.parts.length ?? 0,
        type: block.type,
        callId: tool ? block.id : undefined,
        stopped: false
      })
      if (tool) chunks.push({ type: 'tool-input-start', toolCallId: block.id, toolName: block.name, dynamic: true })
      else if (block.type === 'text') {
        chunks.push({ type: 'text-start', id: key })
        if (block.text) chunks.push({ type: 'text-delta', id: key, delta: block.text })
      } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        chunks.push({ type: 'reasoning-start', id: key })
        if (block.type === 'thinking' && block.thinking)
          chunks.push({ type: 'reasoning-delta', id: key, delta: block.thinking })
      }
    }
    const block = stream.blocks.get(event.index)
    if (!block) return []
    if (event.type === 'content_block_delta') {
      const delta = event.delta
      if (delta.type === 'text_delta') chunks.push({ type: 'text-delta', id: key, delta: delta.text })
      if (delta.type === 'thinking_delta') chunks.push({ type: 'reasoning-delta', id: key, delta: delta.thinking })
      if (delta.type === 'signature_delta')
        chunks.push({
          type: 'reasoning-delta',
          id: key,
          delta: '',
          providerMetadata: { anthropic: { signature: delta.signature } }
        })
      if (delta.type === 'input_json_delta' && block.callId)
        chunks.push({ type: 'tool-input-delta', toolCallId: block.callId, inputTextDelta: delta.partial_json })
    }
    if (event.type === 'content_block_stop') {
      block.stopped = true
      if (block.type === 'text') chunks.push({ type: 'text-end', id: key })
      if (block.type === 'thinking' || block.type === 'redacted_thinking')
        chunks.push({ type: 'reasoning-end', id: key })
      if (block.callId) {
        const part = stream.message?.parts.find(
          (part) => part.type === 'dynamic-tool' && part.toolCallId === block.callId
        )
        if (part?.type === 'dynamic-tool')
          chunks.push({
            type: 'tool-input-available',
            toolCallId: block.callId,
            toolName: part.toolName,
            input: part.input,
            dynamic: true
          })
      }
    }
    if (!chunks.length) return []
    stream.message = await stream.reader.append(chunks, 'partial')
    if (block.bound) {
      const owner = this.messages.get(block.bound)
      if (owner && block.callId && block.stopped && !this.aborted.has(block.bound)) {
        const call = this.calls.get(block.callId)
        if (call?.part.state === 'input-streaming') call.part = { ...call.part, state: 'input-available' }
        const value = {
          ...owner,
          parts: owner.parts.map(
            (part): Part =>
              part.type === 'dynamic-tool' && part.toolCallId === block.callId && part.state === 'input-streaming'
                ? { ...part, state: 'input-available' }
                : part
          )
        }
        return [this.upsert(value)]
      }
    }
    return this.preview()
  }

  restore(messages: readonly SessionMessage[], entries: readonly SessionStoreEntry[]): ClaudeArchive {
    const before = this.feed.snapshot
    const metadata = new Map(entries.filter((entry) => entry.uuid).map((entry) => [entry.uuid!, entry]))
    const removals = entries.flatMap((entry) => {
      const ids = entry.supersedes ?? entry.retracted_message_uuids
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
    })
    const events = this.remove(removals)
    const selected = messages.filter((message) => !this.retracted.has(message.uuid))
    const inputs = new Map(before.inputs.map((input) => [input.nativeInput?.id, input.inputId]))
    for (const message of selected)
      events.push(
        ...this.message(message, {
          aborted: metadata.get(message.uuid)?.isAbortedMidStream === true,
          inputId: inputs.get(runtimeId<'native-input'>(message.uuid))
        })
      )
    this.feed.publish(
      events,
      selected.map((message) => ({ source: 'archive', message })),
      this.legacy
    )
    const content = selected.flatMap((message) =>
      this.messages.has(message.uuid) ? [this.messages.get(message.uuid)!] : []
    )
    const ids = new Set(content.map((message) => message.id))
    const retained = new Map<string | undefined, RuntimeMessage[]>()
    let anchor: string | undefined
    for (const message of before.messages) {
      if (ids.has(message.id)) anchor = message.id
      else if (!this.retracted.has(message.id)) retained.set(anchor, [...(retained.get(anchor) ?? []), message])
    }
    this.feed.publish([
      {
        ...this.feed.snapshot,
        coverage: retained.size ? 'retained-view' : 'current-view',
        messages: [
          ...(retained.get(undefined) ?? []),
          ...content.flatMap((message) => [message, ...(retained.get(message.id) ?? [])])
        ]
      }
    ])
    return {
      thread: this.thread,
      coverage: 'current-view',
      content,
      legacy: { ...this.legacy },
      sources: selected.flatMap((message) => this.sources.get(message.uuid) ?? []),
      messages: selected,
      retracted: [...this.retracted]
    }
  }

  async close(): Promise<void> {
    await this.stream?.reader.close()
  }

  publish(events: readonly ObservationPayload[], message?: ClaudeNativeMessage): void {
    this.feed.publish(events, message ? [message] : [], this.legacy)
  }
}
