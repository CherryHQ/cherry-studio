import { randomUUID } from 'node:crypto'

import type {
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SessionMessage,
  SessionStoreEntry
} from '@anthropic-ai/claude-agent-sdk'

import {
  runtimeId,
  type ContentItem,
  type ContentPart,
  type InputId,
  type ItemRef,
  type ObservationPayload,
  type Thread
} from '@cherrystudio/agent-runtime'

import { ClaudeFeed } from './observation'
import type { ClaudeArchive, ClaudeNativeMessage, ClaudeSource } from './types'

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function parts(value: unknown): ContentPart[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }]
  return Array.isArray(value)
    ? value.flatMap<ContentPart>((part) => {
        const block = object(part)
        if (block?.type === 'text' && typeof block.text === 'string')
          return [{ type: 'text' as const, text: block.text }]
        if (block?.type === 'thinking' && typeof block.thinking === 'string')
          return [{ type: 'reasoning' as const, text: block.thinking }]
        return []
      })
    : []
}

export class ClaudeProjection {
  readonly feed: ClaudeFeed
  readonly retracted = new Set<string>()
  private readonly sources = new Map<string, ClaudeSource[]>()
  private readonly calls = new Map<string, ItemRef>()
  private readonly aborted = new Set<string>()
  private readonly liveSources = new Set<string>()
  private readonly generationId = randomUUID()
  private generation = 0
  private stream?: {
    id: string
    generation: number
    blocks: Map<number, { item: ContentItem; bound: boolean; stopped: boolean; aborted?: boolean }>
  }

  constructor(
    readonly thread: Thread,
    report: (error: unknown) => void
  ) {
    this.feed = new ClaudeFeed(report)
  }

  ref(uuid: string, block: number): ItemRef {
    return { session: this.thread, id: runtimeId<'item'>(`${uuid}:${block}`) }
  }

  remove(uuids: readonly string[]): ObservationPayload[] {
    return uuids.flatMap((uuid) => {
      this.retracted.add(uuid)
      this.feed.forget(uuid)
      return (this.sources.get(uuid) ?? []).map(({ ref }) => ({ type: 'item.remove' as const, ref }))
    })
  }

  message(
    message: SessionMessage | SDKAssistantMessage | { type: 'user'; uuid: string; message: unknown },
    options: { aborted?: boolean; inputId?: InputId; live?: boolean } = {}
  ): ObservationPayload[] {
    if (this.retracted.has(message.uuid)) return []
    if (options.aborted) this.aborted.add(message.uuid)
    const body = object(message.message)
    if (!body) return []
    const content = typeof body.content === 'string' ? [{ type: 'text', text: body.content }] : body.content
    if (!Array.isArray(content)) return []
    const events: ObservationPayload[] = []
    const sources: ClaudeSource[] = []
    for (const [index, raw] of content.entries()) {
      const block = object(raw)
      if (!block) continue
      const ref = this.ref(message.uuid, index)
      const completeness = this.aborted.has(message.uuid) ? 'partial' : 'complete'
      let item: ContentItem
      if (
        (block.type === 'tool_use' || block.type === 'mcp_tool_use' || block.type === 'server_tool_use') &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        item = {
          ref,
          type: 'tool-call',
          name: block.name,
          argumentsText: JSON.stringify(block.input ?? {}),
          completeness
        }
        this.calls.set(block.id, ref)
      } else if (typeof block.tool_use_id === 'string') {
        item = {
          ref,
          type: 'tool-result',
          call: typeof block.tool_use_id === 'string' ? this.calls.get(block.tool_use_id) : undefined,
          parts: parts(block.content),
          outcome: block.is_error === true ? 'error' : 'success'
        }
      } else {
        item = { ref, type: 'message', role: message.type, parts: parts([raw]), completeness, inputId: options.inputId }
      }
      const provisional =
        options.live &&
        !this.liveSources.has(message.uuid) &&
        message.type === 'assistant' &&
        this.stream?.id === body.id
          ? [...this.stream!.blocks.values()].find(
              (entry) =>
                !entry.bound &&
                entry.item.type === item.type &&
                (item.type !== 'tool-call' || (entry.item.type === 'tool-call' && entry.item.name === item.name))
            )
          : undefined
      if (provisional) {
        provisional.bound = true
        provisional.aborted = options.aborted
        if (item.type === 'tool-call' && !provisional.stopped) item = { ...item, completeness: 'partial' }
      }
      events.push({ type: 'item.upsert', item, replaces: provisional ? [provisional.item.ref] : undefined })
      if (provisional) provisional.item = item
      sources.push({ ref, uuid: message.uuid, block: index })
    }
    this.sources.set(message.uuid, sources)
    if (options.live) this.liveSources.add(message.uuid)
    return events
  }

  partial(message: SDKPartialAssistantMessage): ObservationPayload[] {
    const event = message.event
    if (event.type === 'message_start') {
      this.stream = { id: event.message.id, generation: ++this.generation, blocks: new Map() }
      return [{ type: 'activity.changed', activity: { scope: 'foreground', state: 'active' } }]
    }
    if (!this.stream || !('index' in event)) return []
    if (event.type === 'content_block_start') {
      const block = event.content_block
      const ref = this.ref(`live:${this.generationId}:${this.stream.generation}:${this.stream.id}`, event.index)
      const item: ContentItem =
        block.type === 'tool_use' || block.type === 'mcp_tool_use' || block.type === 'server_tool_use'
          ? { ref, type: 'tool-call', name: block.name, argumentsText: '', completeness: 'partial' }
          : { ref, type: 'message', role: 'assistant', parts: parts([block]), completeness: 'partial' }
      this.stream.blocks.set(event.index, { item, bound: false, stopped: false })
      if (block.type === 'tool_use' || block.type === 'mcp_tool_use' || block.type === 'server_tool_use')
        this.calls.set(block.id, ref)
      return [{ type: 'item.upsert', item }]
    }
    const block = this.stream.blocks.get(event.index)
    if (!block) return []
    if (event.type === 'content_block_delta' && !block.bound) {
      const delta = event.delta
      if (delta.type === 'input_json_delta' && block.item.type === 'tool-call') {
        block.item = { ...block.item, argumentsText: block.item.argumentsText + delta.partial_json }
      } else if ((delta.type === 'text_delta' || delta.type === 'thinking_delta') && block.item.type === 'message') {
        const type = delta.type === 'text_delta' ? 'text' : 'reasoning'
        const text = delta.type === 'text_delta' ? delta.text : delta.thinking
        block.item = {
          ...block.item,
          parts: [{ type, text: block.item.parts.map((part) => part.text).join('') + text }]
        }
      } else return []
    } else if (event.type === 'content_block_stop') {
      block.stopped = true
      if (block.aborted || block.item.type === 'tool-result') return []
      block.item = { ...block.item, completeness: 'complete' }
    } else return []
    return [{ type: 'item.upsert', item: block.item }]
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
      selected.map((message) => ({ source: 'archive', message }))
    )
    const ids = new Set(selected.flatMap((message) => this.sources.get(message.uuid)?.map(({ ref }) => ref.id) ?? []))
    const items = events.flatMap((event) => (event.type === 'item.upsert' ? [event.item] : []))
    const retained = new Map<string | undefined, ContentItem[]>()
    const removed = new Set(events.flatMap((event) => (event.type === 'item.remove' ? [event.ref.id] : [])))
    let anchor: string | undefined
    for (const item of before.items) {
      if (ids.has(item.ref.id)) anchor = item.ref.id
      else if (!removed.has(item.ref.id)) retained.set(anchor, [...(retained.get(anchor) ?? []), item])
    }
    this.feed.publish([
      {
        ...this.feed.snapshot,
        coverage: retained.size ? 'retained-view' : 'current-view',
        items: [
          ...(retained.get(undefined) ?? []),
          ...items.flatMap((item) => [item, ...(retained.get(item.ref.id) ?? [])])
        ]
      }
    ])
    return {
      thread: this.thread,
      coverage: 'current-view',
      items,
      sources: selected.flatMap((message) => this.sources.get(message.uuid) ?? []),
      messages: selected,
      retracted: [...this.retracted]
    }
  }

  publish(events: readonly ObservationPayload[], message?: ClaudeNativeMessage): void {
    this.feed.publish(events, message ? [message] : [])
  }
}
