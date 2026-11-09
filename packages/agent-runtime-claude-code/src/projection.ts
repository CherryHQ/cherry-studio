import { randomUUID } from 'node:crypto'

import type {
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
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

import {
  decodeArchiveContent,
  json,
  projectBlock,
  type NativeBlock,
  type ProjectedBlock,
  type ToolResult
} from './content'
import { ClaudeControlState, type ClaudeControl } from './control'
import { ClaudeInvocations } from './invocations'
import { ClaudeFeed } from './observation'
import type { ClaudeArchive, ClaudeNativeMessage } from './types'

type Part = RuntimeMessage['parts'][number]
type ToolPart = Extract<Part, { type: 'dynamic-tool' }>
/** The CLI's failure report: its typed `error` (pinned SDK 0.3.284) or its own `isApiErrorMessage`
 *  flag — not `<synthetic>` alone, which also labels successful `/context` and `/usage` replies. */
function isApiErrorDiagnostic(message: SDKAssistantMessage): boolean {
  const envelope = message as SDKAssistantMessage & { is_api_error_message?: unknown; isApiErrorMessage?: unknown }
  return message.error !== undefined || envelope.is_api_error_message === true || envelope.isApiErrorMessage === true
}

export class ClaudeProjection {
  readonly feed: ClaudeFeed
  private readonly invocations = new ClaudeInvocations()
  private readonly pendingControls: ClaudeControl[] = []
  readonly control = new ClaudeControlState((event) => this.pendingControls.push(event))
  readonly retracted = new Set<string>()
  private readonly sources = new Set<string>()
  private readonly legacy: Record<string, { messageId: string; parts: number[] }> = {}
  private readonly messages = new Map<string, RuntimeMessage>()
  private readonly calls = new Map<string, { id: string; part: ToolPart }>()
  private readonly results = new Map<string, Set<string>>()
  private readonly aborted = new Set<string>()
  private readonly denied = new Set<string>()
  private stream?: {
    apiId: string
    id: string
    reader: RuntimeMessageStream
    blocks: Map<
      number,
      {
        part: number
        type: NativeBlock['type']
        callId?: string
        bound?: string
        stopped: boolean
        citations?: NonNullable<Extract<NativeBlock, { type: 'text' }>['citations']>
      }
    >
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
    message = {
      ...message,
      parts: message.parts.map((part) =>
        part.type === 'dynamic-tool' && this.denied.has(part.toolCallId)
          ? {
              type: 'dynamic-tool',
              toolName: part.toolName,
              toolCallId: part.toolCallId,
              input: part.input,
              callProviderMetadata: part.callProviderMetadata,
              state: 'output-denied',
              approval: { id: part.toolCallId, approved: false }
            }
          : part
      )
    }
    for (const ref of replaces ?? []) this.messages.delete(ref.id)
    this.messages.set(message.id, message)
    return { type: 'message.upsert', message, replaces }
  }

  deny(toolCallId: string): ObservationPayload[] {
    this.denied.add(toolCallId)
    return [...this.messages.values()]
      .filter((message) => message.parts.some((part) => part.type === 'dynamic-tool' && part.toolCallId === toolCallId))
      .map((message) => this.upsert(message))
  }

  committed(archive: ClaudeArchive): ClaudeArchive {
    const content = this.feed.snapshot.messages.filter(
      (message) => this.sources.has(message.id) && !this.retracted.has(message.id)
    )
    return {
      ...archive,
      content,
      legacy: { ...this.legacy },
      retracted: [...this.retracted]
    }
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
    message: SDKAssistantMessage | SDKUserMessage,
    options: { aborted?: boolean; inputId?: InputId; live?: boolean } = {}
  ): ObservationPayload[] {
    if (!message.uuid) return []
    if (options.aborted) this.aborted.add(message.uuid)
    const partial = this.aborted.has(message.uuid)
    const content = message.message.content
    // A provider failure reaches the transcript as an assistant message whose text is the raw API
    // error; that diagnostic belongs to the error channel, not to the assistant's own words.
    const diagnostic = message.type === 'assistant' && isApiErrorDiagnostic(message)
    const blocks = (typeof content === 'string' ? [{ type: 'text' as const, text: content }] : content)
      .filter((block) => !diagnostic || block.type !== 'text')
      .map((block) => projectBlock(block, partial))
    return this.upsertContent(
      message.uuid,
      message.type,
      blocks,
      message.type === 'assistant' ? message.message.id : undefined,
      options
    )
  }

  private upsertContent(
    uuid: string,
    role: RuntimeMessage['role'],
    content: (ProjectedBlock | undefined)[],
    apiId?: string,
    options: { inputId?: InputId; live?: boolean } = {}
  ): ObservationPayload[] {
    if (this.retracted.has(uuid)) return []
    const events: ObservationPayload[] = []
    const value: RuntimeMessage = {
      id: uuid,
      role,
      parts: [],
      metadata: { completeness: this.aborted.has(uuid) ? 'partial' : 'complete', inputId: options.inputId }
    }
    const bound: number[] = []
    for (const [index, block] of content.entries()) {
      if (!block) continue
      if ('result' in block) {
        events.push(...this.applyResult(uuid, block.result))
        continue
      }
      let part = block.part
      const provisional =
        options.live && this.stream?.apiId === apiId
          ? [...this.stream!.blocks.entries()].find(
              ([, entry]) =>
                !entry.bound &&
                entry.type === block.type &&
                (!entry.callId || (part.type === 'dynamic-tool' && entry.callId === part.toolCallId))
            )
          : undefined
      if (provisional) {
        provisional[1].bound = uuid
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
          .get(uuid)
          ?.parts.find((item) => item.type === 'dynamic-tool' && item.toolCallId === callId)
        this.calls.set(part.toolCallId, { id: uuid, part })
        if (previous?.type === 'dynamic-tool' && previous.state.startsWith('output-')) part = previous
      }
      this.legacy[`${uuid}:${index}`] = { messageId: uuid, parts: [value.parts.length] }
      value.parts.push(part)
    }
    this.sources.add(uuid)
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

  private applyResult(uuid: string, result: ToolResult): ObservationPayload[] {
    const call = this.calls.get(result.toolUseId)
    const owner = call && this.messages.get(call.id)
    if (!call || !owner) return []
    const base = {
      type: 'dynamic-tool' as const,
      toolName: call.part.toolName,
      toolCallId: call.part.toolCallId,
      input: call.part.input,
      callProviderMetadata: call.part.callProviderMetadata
    }
    const part: ToolPart =
      result.errorText !== undefined
        ? {
            ...base,
            state: 'output-error',
            errorText: result.errorText,
            resultProviderMetadata: { anthropic: { result: json(result.output) } }
          }
        : { ...base, state: 'output-available', output: result.output }
    const calls = this.results.get(uuid) ?? new Set<string>()
    calls.add(result.toolUseId)
    this.results.set(uuid, calls)
    return [
      this.upsert({
        ...owner,
        parts: owner.parts.map((previous) =>
          previous.type === 'dynamic-tool' && previous.toolCallId === result.toolUseId ? part : previous
        )
      })
    ]
  }

  result(message: SDKResultMessage): ObservationPayload[] {
    if (message.subtype !== 'success' || message.structured_output === undefined) return []
    return this.upsertContent(message.uuid, 'assistant', [
      projectBlock({ type: 'text', text: JSON.stringify(message.structured_output) }, false)
    ])
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
    switch (event.type) {
      case 'message_start': {
        await this.stream?.reader.close()
        const id = `live:${randomUUID()}`
        this.stream = { apiId: event.message.id, id, reader: new RuntimeMessageStream(id), blocks: new Map() }
        return [{ type: 'activity.changed', activity: { state: 'active' } }]
      }
      // Turn usage/outcome comes from SDK result; message_stop also occurs on interrupted input.
      case 'message_delta':
      case 'message_stop':
        return []
      case 'content_block_start':
      case 'content_block_delta':
      case 'content_block_stop':
        break
      default: {
        const exhaustive: never = event
        void exhaustive
        return []
      }
    }
    const stream = this.stream
    if (!stream) return []
    type Chunk = Parameters<RuntimeMessageStream['append']>[0][number]
    const chunks: Chunk[] = []
    const key = String(event.index)
    if (event.type === 'content_block_start') {
      const block = event.content_block
      const projected = projectBlock(block, true)
      if (!projected) return []
      // Results commit with the transcript UUID that subsequent retractions address.
      if ('result' in projected) return []
      const part = projected.part
      stream.blocks.set(event.index, {
        part: stream.message?.parts.length ?? 0,
        type: block.type,
        callId: part.type === 'dynamic-tool' ? part.toolCallId : undefined,
        stopped: false,
        citations: block.type === 'text' ? (block.citations ?? []) : undefined
      })
      if (part.type === 'dynamic-tool')
        chunks.push({
          type: 'tool-input-start',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          dynamic: true,
          providerMetadata: part.callProviderMetadata
        })
      else if (part.type === 'text') {
        chunks.push({
          type: 'text-start',
          id: key,
          providerMetadata: part.providerMetadata
        })
        if (part.text) chunks.push({ type: 'text-delta', id: key, delta: part.text })
      } else if (part.type === 'reasoning') {
        chunks.push({
          type: 'reasoning-start',
          id: key,
          providerMetadata: part.providerMetadata
        })
        if (part.text) chunks.push({ type: 'reasoning-delta', id: key, delta: part.text })
      }
    }
    const block = stream.blocks.get(event.index)
    if (!block) return []
    if (event.type === 'content_block_delta') {
      const delta = event.delta
      switch (delta.type) {
        case 'text_delta':
          chunks.push({ type: 'text-delta', id: key, delta: delta.text })
          break
        case 'thinking_delta':
          chunks.push({ type: 'reasoning-delta', id: key, delta: delta.thinking })
          break
        case 'signature_delta':
          chunks.push({
            type: 'reasoning-delta',
            id: key,
            delta: '',
            providerMetadata: { anthropic: { signature: delta.signature } }
          })
          break
        case 'citations_delta':
          block.citations = [...(block.citations ?? []), delta.citation]
          chunks.push({
            type: 'text-delta',
            id: key,
            delta: '',
            providerMetadata: { anthropic: { citations: json(block.citations) } }
          })
          break
        case 'input_json_delta':
          if (block.callId)
            chunks.push({ type: 'tool-input-delta', toolCallId: block.callId, inputTextDelta: delta.partial_json })
          break
        case 'compaction_delta':
          break
        default: {
          const exhaustive: never = delta
          void exhaustive
        }
      }
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
            providerMetadata: part.callProviderMetadata,
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
    for (const message of selected) {
      if (metadata.get(message.uuid)?.isAbortedMidStream === true) this.aborted.add(message.uuid)
      const decoded = decodeArchiveContent(message.message, this.aborted.has(message.uuid))
      if (decoded)
        events.push(
          ...this.upsertContent(message.uuid, message.type, decoded.blocks, decoded.id, {
            inputId: inputs.get(runtimeId<'native-input'>(message.uuid))
          })
        )
    }
    this.feed.publish(
      events,
      selected.map((message): ClaudeNativeMessage => {
        const entry = metadata.get(message.uuid)
        return {
          source: 'archive',
          message,
          ...(message.type === 'assistant' && entry?.type === 'assistant' && entry.isApiErrorMessage === true
            ? { isApiErrorMessage: true as const }
            : {})
        }
      }),
      this.legacy
    )
    const content = selected.flatMap((message) =>
      this.messages.has(message.uuid) ? [this.messages.get(message.uuid)!] : []
    )
    const ids = new Set(content.map((message) => message.id))
    const retained = new Map<string | undefined, RuntimeMessage[]>()
    let anchor: string | undefined
    for (const message of this.feed.snapshot.messages) {
      if (ids.has(message.id)) anchor = message.id
      else if (!this.retracted.has(message.id)) retained.set(anchor, [...(retained.get(anchor) ?? []), message])
    }
    this.feed.publish([
      {
        ...this.feed.snapshot,
        messages: [
          ...(retained.get(undefined) ?? []),
          ...content.flatMap((message) => [message, ...(retained.get(message.id) ?? [])])
        ]
      }
    ])
    return {
      content,
      legacy: { ...this.legacy },
      retracted: [...this.retracted]
    }
  }

  async close(): Promise<void> {
    await this.stream?.reader.close()
    this.feed.publish([], [], this.legacy, this.invocations.close())
  }

  publish(
    events: readonly ObservationPayload[],
    message?: ClaudeNativeMessage,
    controls: readonly ClaudeControl[] = []
  ): void {
    const invocations =
      message?.source === 'live' && message.message.type !== 'command_lifecycle'
        ? this.invocations.accept(message.message)
        : []
    if (controls.some((control) => control.type === 'input-boundary')) this.control.beginTurn()
    if (message?.source === 'live' && message.message.type !== 'command_lifecycle') this.control.accept(message.message)
    this.feed.publish(
      events,
      message ? [message] : [],
      this.legacy,
      invocations,
      [...controls, ...this.pendingControls.splice(0)],
      this.control.snapshot
    )
  }
}
