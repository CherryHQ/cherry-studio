import { randomUUID } from 'node:crypto'

import type {
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
  SessionMessage
} from '@anthropic-ai/claude-agent-sdk'
import { parsePartialJson } from 'ai'

import {
  messageObservation,
  runtimeId,
  type RuntimePartEdit,
  type RuntimeMessage,
  type InputId,
  type ItemRef,
  type ObservationPayload,
  type Thread
} from '@cherrystudio/agent-runtime'

import type { NativeArchiveEntry } from './archive'
import {
  citationMetadata,
  decodeArchiveContent,
  projectBlock,
  type NativeBlock,
  type ProjectedBlock,
  type ToolResult
} from './content'
import { ClaudeControlState, type ClaudeControl } from './control'
import { ClaudeInvocations } from './invocations'
import { ClaudeFeed } from './observation'
import { isSyntheticTurnCloser } from './synthetic'
import type { ClaudeArchive, ClaudeNativeMessage } from './types'

type Part = RuntimeMessage['parts'][number]
type ToolPart = Extract<Part, { type: 'dynamic-tool' }>
function deniedTool(part: ToolPart): ToolPart {
  return {
    type: 'dynamic-tool',
    toolName: part.toolName,
    toolCallId: part.toolCallId,
    input: part.input,
    callProviderMetadata: part.callProviderMetadata,
    state: 'output-denied',
    approval: { id: part.toolCallId, approved: false }
  }
}

export class ClaudeProjection {
  readonly feed: ClaudeFeed
  private readonly invocations = new ClaudeInvocations()
  private readonly pendingControls: ClaudeControl[] = []
  readonly control = new ClaudeControlState((event) => this.pendingControls.push(event))
  readonly retracted = new Set<string>()
  private readonly sources = new Set<string>()
  private readonly legacy: Record<string, { messageId: string; parts: number[] }> = {}
  private legacyChanged = false
  private readonly messages = new Map<string, RuntimeMessage>()
  private readonly calls = new Map<string, { id: string; index: number; part: ToolPart }>()
  private readonly results = new Map<string, Set<string>>()
  private readonly aborted = new Set<string>()
  private readonly denied = new Set<string>()
  private opening?: { toolCallId: string } | { nativeId: string }
  private stream?: {
    apiId: string
    id: string
    blocks: Map<
      number,
      {
        part: number
        value: Part
        json?: string
        type: NativeBlock['type']
        callId?: string
        bound?: string
        stopped: boolean
      }
    >
  }

  constructor(
    readonly thread: Thread,
    report: (error: unknown) => void
  ) {
    this.feed = new ClaudeFeed(report, this.control)
  }

  ref(uuid: string): ItemRef {
    return { session: this.thread, id: runtimeId(uuid) }
  }

  private updateSource(
    message: RuntimeMessage,
    replaces?: readonly ItemRef[],
    changedParts?: readonly number[]
  ): ObservationPayload {
    message = {
      ...message,
      parts: message.parts.map((part) =>
        part.type === 'dynamic-tool' && this.denied.has(part.toolCallId) ? deniedTool(part) : part
      )
    }
    const previous = this.messages.get(message.id)
    if (
      this.opening &&
      'nativeId' in this.opening &&
      this.opening.nativeId === message.id &&
      this.sources.delete(this.thread.id)
    )
      replaces = [this.ref(this.thread.id)]
    for (const ref of replaces ?? []) this.messages.delete(ref.id)
    this.messages.set(message.id, { ...message, parts: message.parts.slice() })
    return messageObservation(this.ref(message.id), previous, message, replaces, changedParts)
  }

  deny(toolCallId: string): ObservationPayload[] {
    this.denied.add(toolCallId)
    const call = this.calls.get(toolCallId)
    const owner = call && this.messages.get(call.id)
    const part = call && owner?.parts[call.index]
    if (
      !owner ||
      !call ||
      part?.type !== 'dynamic-tool' ||
      part.toolCallId !== toolCallId ||
      part.state === 'output-denied'
    )
      return []
    const value = deniedTool(part)
    owner.parts[call.index] = value
    return [{ type: 'message.parts', ref: this.ref(call.id), changes: [{ type: 'put', part: call.index, value }] }]
  }

  spawnCall(toolCallId: string): ToolPart | undefined {
    const call = this.calls.get(toolCallId)
    const part = call && this.messages.get(call.id)?.parts[call.index]
    return part?.type === 'dynamic-tool' && part.toolCallId === toolCallId && ['Agent', 'Task'].includes(part.toolName)
      ? part
      : undefined
  }

  startBackgroundTask(toolCallId: string, prompt: string): ObservationPayload[] {
    if (this.opening) return []
    this.opening = { toolCallId }
    this.sources.add(this.thread.id)
    return [
      this.updateSource({
        id: this.thread.id,
        role: 'user',
        parts: [{ type: 'text', text: prompt, state: 'done' }],
        metadata: { completeness: 'complete' }
      })
    ]
  }

  committed(): ClaudeArchive {
    return {
      content: this.feed.snapshot.messages.filter(
        (message) => this.sources.has(message.id) && !this.retracted.has(message.id)
      ),
      ...(this.opening && 'nativeId' in this.opening && { aliases: { [this.opening.nativeId]: this.thread.id } }),
      legacy: { ...this.legacy },
      retracted: [...this.retracted]
    }
  }

  remove(uuids: readonly string[]): ObservationPayload[] {
    const events: ObservationPayload[] = []
    if (
      this.opening &&
      'nativeId' in this.opening &&
      uuids.includes(this.opening.nativeId) &&
      this.sources.delete(this.thread.id)
    )
      uuids = [...uuids, this.thread.id]
    for (const uuid of uuids) {
      this.retracted.add(uuid)
      this.feed.forget(uuid)
      for (const callId of this.results.get(uuid) ?? []) {
        const call = this.calls.get(callId)
        const owner = call && this.messages.get(call.id)
        if (owner && call && !this.denied.has(callId)) {
          owner.parts[call.index] = call.part
          events.push({
            type: 'message.parts',
            ref: this.ref(call.id),
            changes: [{ type: 'put', part: call.index, value: call.part }]
          })
        }
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
    if (!message.uuid || (message.type === 'assistant' && isSyntheticTurnCloser(message.message))) return []
    if (options.aborted) this.aborted.add(message.uuid)
    const partial = this.aborted.has(message.uuid)
    const content = message.message.content
    if (
      this.opening &&
      'toolCallId' in this.opening &&
      message.type === 'user' &&
      message.parent_tool_use_id === this.opening.toolCallId &&
      this.sources.size === 1 &&
      (typeof content === 'string' || content.some((block) => block.type === 'text'))
    )
      this.opening = { nativeId: message.uuid }
    return this.updateContent(
      message.uuid,
      message.type,
      typeof content === 'string'
        ? [projectBlock({ type: 'text', text: content }, partial)]
        : content.map((block) => projectBlock(block, partial)),
      message.type === 'assistant' ? message.message.id : undefined,
      options
    )
  }

  private updateContent(
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
        const prior = this.calls.get(callId)
        const previous = prior?.id === uuid ? this.messages.get(uuid)?.parts[prior.index] : undefined
        this.calls.set(part.toolCallId, { id: uuid, index: value.parts.length, part })
        if (previous?.type === 'dynamic-tool' && previous.state.startsWith('output-')) part = previous
      }
      const key = `${uuid}:${index}`
      if (this.legacy[key]?.messageId !== uuid || this.legacy[key]?.parts[0] !== value.parts.length) {
        this.legacy[key] = { messageId: uuid, parts: [value.parts.length] }
        this.legacyChanged = true
      }
      value.parts.push(part)
    }
    this.sources.add(uuid)
    if (value.parts.length || content.length === 0) {
      const replaces = bound.length && this.stream ? [this.ref(this.stream.id)] : undefined
      events.push(this.updateSource(value, replaces))
      if (bound.length && this.stream) {
        this.stream.id = `live:${randomUUID()}`
        events.push(...this.preview())
      }
    }
    return events
  }

  private applyResult(uuid: string, result: ToolResult): ObservationPayload[] {
    const call = this.calls.get(result.toolCallId)
    const owner = call && this.messages.get(call.id)
    if (!call || !owner) return []
    const part: ToolPart = {
      ...result,
      type: 'dynamic-tool',
      toolName: call.part.toolName,
      input: call.part.input,
      callProviderMetadata: call.part.callProviderMetadata
    }
    const calls = this.results.get(uuid) ?? new Set<string>()
    calls.add(result.toolCallId)
    this.results.set(uuid, calls)
    if (this.denied.has(result.toolCallId)) return []
    owner.parts[call.index] = part
    return [{ type: 'message.tool-output', ref: this.ref(owner.id), part: call.index, tool: part }]
  }

  result(message: SDKResultMessage, correlatedCommand = false): ObservationPayload[] {
    if (message.subtype !== 'success') return []
    const text =
      message.structured_output !== undefined
        ? JSON.stringify(message.structured_output)
        : correlatedCommand && message.local_command && !message.is_error
          ? message.result || `/${message.local_command}`
          : undefined
    return text ? this.updateContent(message.uuid, 'assistant', [projectBlock({ type: 'text', text }, false)]) : []
  }

  private preview(): ObservationPayload[] {
    const stream = this.stream
    if (!stream) return []
    const parts: Part[] = []
    for (const block of stream.blocks.values()) {
      if (block.bound) continue
      block.part = parts.length
      parts.push(block.value)
      if (block.value.type === 'dynamic-tool')
        this.calls.set(block.value.toolCallId, { id: stream.id, index: block.part, part: block.value })
    }
    return parts.length
      ? [this.updateSource({ id: stream.id, role: 'assistant', parts, metadata: { completeness: 'partial' } })]
      : []
  }

  async partial(message: SDKPartialAssistantMessage): Promise<ObservationPayload[]> {
    const event = message.event
    if (event.type === 'message_start') {
      this.stream = { apiId: event.message.id, id: `live:${randomUUID()}`, blocks: new Map() }
      return [{ type: 'activity.changed', activity: { state: 'active' } }]
    }
    const stream = this.stream
    if (!stream || !('index' in event)) return []
    const ref = this.ref(stream.id)
    if (event.type === 'content_block_start') {
      const block = event.content_block
      const projected = projectBlock(block, true)
      if (!projected || !('part' in projected) || stream.blocks.has(event.index)) return []
      const value =
        projected.part.type === 'dynamic-tool' && this.denied.has(projected.part.toolCallId)
          ? deniedTool(projected.part)
          : projected.part
      const events: ObservationPayload[] = []
      let owner = this.messages.get(stream.id)
      if (!owner) {
        owner = { id: stream.id, role: 'assistant', metadata: { completeness: 'partial' }, parts: [] }
        this.messages.set(stream.id, owner)
        events.push({ type: 'message.reconcile', message: { ...owner, parts: [] } })
      }
      const part = owner.parts.push(value) - 1
      stream.blocks.set(event.index, {
        type: block.type,
        part,
        value,
        stopped: false,
        callId: value.type === 'dynamic-tool' ? value.toolCallId : undefined
      })
      if (value.type === 'text' || value.type === 'reasoning') {
        events.push({
          type: 'message.text-open',
          ref,
          part,
          kind: value.type,
          ...(value.providerMetadata && { providerMetadata: value.providerMetadata })
        })
        if (value.text) events.push({ type: 'message.text-append', ref, part, text: value.text })
      } else {
        if (value.type === 'dynamic-tool') this.calls.set(value.toolCallId, { id: stream.id, index: part, part: value })
        events.push({ type: 'message.parts', ref, changes: [{ type: 'put', part, value }] })
      }
      return events
    }
    const block = stream.blocks.get(event.index)
    if (!block || block.stopped || (block.callId && this.denied.has(block.callId))) return []
    const value = block.value
    const owner = this.messages.get(block.bound ?? stream.id)
    if (!owner) return []
    const part = block.bound && block.callId ? this.calls.get(block.callId)?.index : block.part
    if (part === undefined) return []
    const address = this.ref(owner.id)
    if (event.type === 'content_block_stop') {
      block.stopped = true
      delete block.json
      if (block.bound && (!block.callId || this.aborted.has(block.bound))) return []
      const before = owner.parts[part]
      if (before?.type === 'dynamic-tool' && before.state === 'input-streaming') {
        const next = { ...before, state: 'input-available' as const }
        owner.parts[part] = block.value = next
        this.calls.set(next.toolCallId, { id: owner.id, index: part, part: next })
        return [{ type: 'message.parts', ref: address, changes: [{ type: 'put', part, value: next }] }]
      }
      if (before?.type !== 'text' && before?.type !== 'reasoning') return []
      owner.parts[part] = block.value = { ...before, state: 'done' }
      return [{ type: 'message.text-finish', ref: address, part }]
    }
    if (block.bound || event.type !== 'content_block_delta') return []
    const delta = event.delta
    if (delta.type === 'input_json_delta' && value.type === 'dynamic-tool' && value.state === 'input-streaming') {
      block.json = (block.json ?? '') + delta.partial_json
      const next = { ...value, input: (await parsePartialJson(block.json)).value }
      owner.parts[part] = block.value = next
      this.calls.set(next.toolCallId, { id: owner.id, index: part, part: next })
      return [{ type: 'message.parts', ref, changes: [{ type: 'put', part, value: next }] }]
    }
    if (value.type !== 'text' && value.type !== 'reasoning') return []
    if (delta.type === 'text_delta' || delta.type === 'thinking_delta') {
      const text = delta.type === 'text_delta' ? delta.text : delta.thinking
      if (!text) return []
      owner.parts[part] = block.value = { ...value, text: value.text + text }
      return [{ type: 'message.text-append', ref, part, text }]
    }
    if (delta.type !== 'citations_delta' && delta.type !== 'signature_delta') return []
    const citations = value.providerMetadata?.anthropic?.citations
    const anthropic =
      delta.type === 'signature_delta'
        ? { signature: delta.signature }
        : { citations: [...(Array.isArray(citations) ? citations : []), citationMetadata(delta.citation)] }
    const providerMetadata = {
      ...value.providerMetadata,
      anthropic: { ...value.providerMetadata?.anthropic, ...anthropic }
    }
    owner.parts[part] = block.value = { ...value, providerMetadata }
    const change: RuntimePartEdit = {
      type: 'correct',
      part,
      kind: value.type,
      state: value.state,
      text: value.text,
      providerMetadata
    }
    return [{ type: 'message.parts', ref, changes: [change] }]
  }

  restore(messages: readonly SessionMessage[], entries: readonly NativeArchiveEntry[]): ClaudeArchive {
    const before = this.feed.snapshot
    const opening = entries.find((entry) => entry.childOpening)?.uuid
    if (opening) this.opening = { nativeId: opening }
    const metadata = new Map(entries.filter((entry) => entry.uuid).map((entry) => [entry.uuid!, entry]))
    const removals = entries.flatMap((entry) => {
      const ids = entry.supersedes ?? entry.retracted_message_uuids
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
    })
    const events = this.remove(removals)
    const selected = messages.filter((message) => !this.retracted.has(message.uuid))
    const inputs = new Map(before.inputs.map((input) => [input.nativeInput?.id, input.inputId]))
    for (const message of selected) {
      if (message.type === 'assistant' && isSyntheticTurnCloser(message.message)) continue
      if (metadata.get(message.uuid)?.isAbortedMidStream === true) this.aborted.add(message.uuid)
      const decoded = decodeArchiveContent(message.message, this.aborted.has(message.uuid))
      if (decoded)
        events.push(
          ...this.updateContent(message.uuid, message.type, decoded.blocks, decoded.id, {
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
    this.legacyChanged = false
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
      ...(opening && { aliases: { [opening]: this.thread.id } }),
      legacy: { ...this.legacy },
      retracted: [...this.retracted]
    }
  }

  async close(): Promise<void> {
    this.stream = undefined
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
    this.feed.publish(events, message ? [message] : [], this.legacyChanged ? this.legacy : undefined, invocations, [
      ...controls,
      ...this.pendingControls.splice(0)
    ])
    this.legacyChanged = false
  }
}
