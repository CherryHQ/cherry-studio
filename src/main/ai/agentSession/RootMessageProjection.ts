import { isDeepStrictEqual } from 'node:util'

import { isDataUIPart, isToolUIPart, type UIMessageChunk } from 'ai'
import { omit } from 'es-toolkit'
import { v7 as uuidv7 } from 'uuid'

import {
  agentSessionContextService as contexts,
  type RootProjectionCheckpoint
} from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import type { RuntimeMessageProjection } from '@main/ai/runtime/types'
import { dropEmptyContentParts, finalizeInterruptedParts, stripTransientStatusParts } from '@main/ai/streamManager'
import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'

type Part = CherryUIMessage['parts'][number]
/** `ids` parallels `parts`: a native source carries no part IDs, so its position maps to one. */
type Source = { messageId: string; parts: CherryUIMessage['parts']; ids: string[] }
type Entry = { id: string; part: Part }

const TERMINAL_TOOL_STATES: ReadonlySet<string> = new Set(['output-available', 'output-error', 'output-denied'])

/** A part reaches its own semantic completion independently of the reply that contains it. */
function isPartDone(part: Part): boolean {
  if (part.type === 'text' || part.type === 'reasoning') return part.state !== 'streaming' && part.text.trim() !== ''
  if (isToolUIPart(part))
    return TERMINAL_TOOL_STATES.has(part.state) && !(part.state === 'output-available' && part.preliminary)
  if (part.type === 'data-agent-task-event') return part.data.status !== 'in_progress'
  return part.type !== 'data-retry'
}

/** Groups native sources into product replies; selected model context never deletes retained sources. */
export class RootMessageProjection {
  private readonly sources = new Map<string, Source>()
  private readonly replySources = new Map<string, Set<string>>()
  private readonly removed = new Set<string>()
  private readonly extras = new Map<string, Entry[]>()
  private readonly toolIds = new Map<string, string>()
  private readonly saved = new Map<string, Part>()
  private readonly pendingTools = new Map<
    string,
    { messageId: string; input?: Extract<UIMessageChunk, { type: 'tool-input-available' }>; approvalId?: string }
  >()

  constructor(readonly contextId: string) {
    const context = contexts.context(contextId)
    const saved = context.checkpointMapping?.root
    for (const id of saved?.removed ?? []) this.removed.add(id)
    const bodies = new Map<string, { parts: CherryUIMessage['parts']; ids: string[] }>()
    const missing = new Set<string>()
    const ranges = new Map<string, { offset: number; count: number }[]>()
    for (const [id, range] of Object.entries(saved?.sources ?? {})) {
      if (this.removed.has(id) || missing.has(range.messageId)) {
        this.removed.add(id)
        continue
      }
      let body = bodies.get(range.messageId)
      if (!body) {
        if (!messages.hasSessionMessage(context.sessionId, range.messageId)) {
          missing.add(range.messageId)
          this.removed.add(id)
          continue
        }
        body = messages.getSessionMessageBody(context.sessionId, range.messageId)
        bodies.set(range.messageId, body)
      }
      const end = range.offset + range.count
      this.sources.set(id, {
        messageId: range.messageId,
        parts: body.parts.slice(range.offset, end),
        ids: body.ids.slice(range.offset, end)
      })
      const owned = ranges.get(range.messageId) ?? []
      owned.push(range)
      ranges.set(range.messageId, owned)
    }
    this.indexSources()
    for (const [messageId, body] of bodies) {
      body.parts.forEach((part, index) => {
        if (isToolUIPart(part)) this.toolIds.set(part.toolCallId, body.ids[index])
        this.saved.set(body.ids[index], part)
      })
      this.extras.set(
        messageId,
        body.parts.flatMap((part, index) =>
          ranges.get(messageId)!.some((range) => index >= range.offset && index < range.offset + range.count)
            ? []
            : [{ id: body.ids[index], part }]
        )
      )
    }
  }

  accept(update: RuntimeMessageProjection, currentMessageId?: string): Map<string, CherryUIMessage['parts']> {
    this.syncRemoved()
    const changed = new Set<string>()
    let reindex = false
    const groups = new Map<string, string[]>()
    for (const [old, source] of Object.entries(update.legacy ?? {})) {
      if (this.removed.has(old) && !this.sources.has(source.messageId)) this.removed.add(source.messageId)
      if (!this.sources.has(old) || old === source.messageId) continue
      groups.set(source.messageId, [...(groups.get(source.messageId) ?? []), old])
    }
    for (const [id, old] of groups) {
      const owners = new Set(old.map((key) => this.sources.get(key)!.messageId))
      const message = update.messages.find((message) => message.id === id)
      if (owners.size !== 1 || !message) continue
      const owner = owners.values().next().value!
      const first = old[0]
      const previous = {
        parts: old.flatMap((key) => this.sources.get(key)!.parts),
        ids: old.flatMap((key) => this.sources.get(key)!.ids)
      }
      const merged = { messageId: owner, parts: message.parts, ids: this.sourceIds(previous, message.parts) }
      const ordered = [...this.sources].flatMap(([key, value]) =>
        key === first ? [[id, merged] as const] : old.includes(key) ? [] : [[key, value] as const]
      )
      this.sources.clear()
      for (const [key, value] of ordered) this.sources.set(key, value)
      reindex = true
      changed.add(owner)
    }
    for (const id of update.removed) {
      this.removed.add(id)
      const previous = this.sources.get(id)
      if (previous) {
        changed.add(previous.messageId)
        this.replySources.get(previous.messageId)?.delete(id)
      }
      this.sources.delete(id)
    }
    for (const [old, replacement] of Object.entries(update.replaces)) {
      const previous = this.sources.get(old)
      if (!previous) {
        if (this.removed.has(old) && !this.sources.has(replacement)) this.removed.add(replacement)
        continue
      }
      const ordered = [...this.sources].map(([id, value]) => [id === old ? replacement : id, value] as const)
      this.sources.clear()
      for (const [id, value] of ordered) this.sources.set(id, value)
      reindex = true
      this.removed.add(old)
    }
    if (reindex) this.indexSources()
    const live = new Set(update.live)
    const refresh = new Set(update.refresh)
    for (const message of update.messages) {
      if (message.role !== 'assistant' || this.removed.has(message.id)) continue
      const previous = this.sources.get(message.id)
      if (previous && !live.has(message.id) && !refresh.has(message.id)) continue
      const owner = previous?.messageId ?? (live.has(message.id) ? currentMessageId : undefined)
      if (!owner) continue
      if (!this.extras.has(owner)) this.extras.set(owner, [])
      if (
        previous?.parts.length !== message.parts.length ||
        message.parts.some((part, index) => part !== previous.parts[index])
      )
        changed.add(owner)
      this.sources.set(message.id, {
        messageId: owner,
        parts: message.parts.slice(),
        ids: this.sourceIds(previous, message.parts)
      })
      for (const part of message.parts) {
        if (isToolUIPart(part) && part.state.startsWith('output-')) this.pendingTools.delete(part.toolCallId)
      }
      const sources = this.replySources.get(owner) ?? new Set<string>()
      sources.add(message.id)
      this.replySources.set(owner, sources)
    }
    return new Map([...changed].map((id) => [id, this.parts(id)!]))
  }

  parts(messageId: string): CherryUIMessage['parts'] | undefined {
    return this.entries(messageId)?.map((entry) => entry.part)
  }

  /** Stable part IDs parallel to `parts(messageId)`. */
  partIds(messageId: string): string[] | undefined {
    return this.entries(messageId)?.map((entry) => entry.id)
  }

  /** Completed parts whose content differs from their last save, with the reply's current part order. */
  completions(messageId: string): { order: string[]; parts: Map<string, Part> } | undefined {
    const entries = this.entries(messageId)
    if (!entries) return undefined
    const parts = new Map<string, Part>()
    for (const { id, part } of entries) {
      const saved = this.saved.get(id)
      if (isPartDone(part) && saved !== part && !isDeepStrictEqual(saved, part)) parts.set(id, part)
    }
    return { order: entries.map((entry) => entry.id), parts }
  }

  /** Records parts committed by a completion save so unchanged parts are not written again. */
  committed(parts: ReadonlyMap<string, Part>): void {
    for (const [id, part] of parts) this.saved.set(id, part)
  }

  private entries(messageId: string): Entry[] | undefined {
    const sources = [...(this.replySources.get(messageId) ?? [])].map((id) => this.sources.get(id)!)
    if (!sources.length && !this.extras.has(messageId)) return undefined
    const entries = sources.flatMap((source) =>
      source.parts.map((part, index) => ({ id: source.ids[index], part: this.decorate(part) }))
    )
    return [...entries, ...this.pendingParts(messageId, entries), ...(this.extras.get(messageId) ?? [])]
  }

  /** Keeps a part's ID across source updates: tool calls by `toolCallId`, other parts by position. */
  private sourceIds(previous: Pick<Source, 'parts' | 'ids'> | undefined, parts: CherryUIMessage['parts']): string[] {
    return parts.map((part, index) => {
      const before = previous?.parts[index]
      if (isToolUIPart(part)) return this.toolId(part.toolCallId)
      return before && !isToolUIPart(before) && before.type === part.type ? previous.ids[index] : uuidv7()
    })
  }

  private toolId(toolCallId: string): string {
    let id = this.toolIds.get(toolCallId)
    if (!id) this.toolIds.set(toolCallId, (id = uuidv7()))
    return id
  }

  private pendingParts(messageId: string, sources: readonly Entry[]): Entry[] {
    const entries: Entry[] = []
    for (const [toolCallId, pending] of this.pendingTools) {
      if (pending.messageId !== messageId || !pending.input || !pending.approvalId) continue
      if (sources.some(({ part }) => isToolUIPart(part) && part.toolCallId === toolCallId)) continue
      entries.push({
        id: this.toolId(toolCallId),
        part: {
          type: 'dynamic-tool',
          toolCallId,
          toolName: pending.input.toolName,
          input: pending.input.input,
          providerExecuted: pending.input.providerExecuted,
          state: 'approval-requested',
          approval: { id: pending.approvalId }
        }
      })
    }
    return entries
  }

  control(messageId: string, control: UIMessageChunk): void {
    const chunk = control as CherryUIMessageChunk
    if (!this.extras.has(messageId)) this.extras.set(messageId, [])
    if (chunk.type === 'tool-input-available' || chunk.type === 'tool-approval-request') {
      const pending = this.pendingTools.get(chunk.toolCallId) ?? { messageId }
      this.pendingTools.set(chunk.toolCallId, {
        ...pending,
        ...(chunk.type === 'tool-input-available' ? { input: chunk } : { approvalId: chunk.approvalId })
      })
    } else if (chunk.type.startsWith('data-')) {
      const part = chunk as Extract<CherryUIMessageChunk, { type: `data-${string}` }>
      if (part.transient) return
      const extras = this.extras.get(messageId)!
      const same = (previous: Part) => isDataUIPart(previous) && previous.type === part.type && previous.id === part.id
      this.extras.set(messageId, [
        ...extras.filter((previous) => !same(previous.part)),
        { id: extras.find((previous) => same(previous.part))?.id ?? uuidv7(), part }
      ])
    }
  }

  private decorate(part: CherryUIMessage['parts'][number]): CherryUIMessage['parts'][number] {
    if (
      !isToolUIPart(part) ||
      part.state === 'output-available' ||
      part.state === 'output-error' ||
      part.state === 'output-denied'
    )
      return part
    const pending = this.pendingTools.get(part.toolCallId)
    if (!pending?.approvalId) return part
    return {
      ...part,
      state: 'approval-requested',
      approval: { id: pending.approvalId },
      input: pending.input?.input ?? part.input
    }
  }

  taskEvent(data: AgentTaskEventPartData): { messageId: string; parts: CherryUIMessage['parts'] } | undefined {
    this.syncRemoved()
    if (!data.toolUseId) return undefined
    const owner = [...this.sources.values()].find((source) =>
      source.parts.some((part) => isToolUIPart(part) && part.toolCallId === data.toolUseId)
    )
    if (!owner) return undefined
    const extras = this.extras.get(owner.messageId) ?? []
    const next = {
      type: 'data-agent-task-event' as const,
      id: `task-${data.taskId}`,
      data: omit(data, ['summary', 'prompt', 'outputFile'])
    }
    const same = ({ part }: Entry) => part.type === next.type && part.data.taskId === data.taskId
    const previous = extras.find(same)
    if (isDeepStrictEqual(previous?.part, next)) return undefined
    this.extras.set(owner.messageId, [
      ...extras.filter((entry) => !same(entry)),
      { id: previous?.id ?? uuidv7(), part: next }
    ])
    return { messageId: owner.messageId, parts: this.parts(owner.messageId)! }
  }

  /** Normalize each owned source before flattening so checkpoint ranges describe the saved body. */
  prepare(message: CherryUIMessage, status: 'success' | 'paused' | 'error'): CherryUIMessage {
    for (const part of message.parts) {
      if (part.type === 'data-error') this.control(message.id, part)
    }
    // Each normalizer keeps, drops or rewrites one part at a time, so IDs follow their own part.
    const normalize = (entries: readonly Entry[]) =>
      entries.flatMap(({ id, part }) =>
        finalizeInterruptedParts(dropEmptyContentParts(stripTransientStatusParts([part])), status).map((next) => ({
          id,
          part: next
        }))
      )
    const sourceEntries = [...(this.replySources.get(message.id) ?? [])].flatMap((id) => {
      const source = this.sources.get(id)!
      return source.parts.map((part, index) => ({ id: source.ids[index], part }))
    })
    const pending = this.pendingParts(message.id, sourceEntries)
    for (const id of this.replySources.get(message.id) ?? []) {
      const source = this.sources.get(id)!
      const entries = normalize(
        source.parts.map((part, index) => ({ id: source.ids[index], part: this.decorate(part) }))
      )
      source.parts = entries.map((entry) => entry.part)
      source.ids = entries.map((entry) => entry.id)
    }
    this.extras.set(message.id, normalize([...pending, ...(this.extras.get(message.id) ?? [])]))
    for (const [id, tool] of this.pendingTools) if (tool.messageId === message.id) this.pendingTools.delete(id)
    return { ...message, parts: this.parts(message.id) ?? [] }
  }

  private indexSources(): void {
    this.replySources.clear()
    for (const [id, source] of this.sources) {
      const ids = this.replySources.get(source.messageId) ?? new Set<string>()
      ids.add(id)
      this.replySources.set(source.messageId, ids)
    }
  }

  private syncRemoved(): void {
    const context = contexts.context(this.contextId)
    for (const id of context.checkpointMapping?.root?.removed ?? []) {
      this.removed.add(id)
      const source = this.sources.get(id)
      if (!source) continue
      this.sources.delete(id)
      this.replySources.get(source.messageId)?.delete(id)
      if (!messages.hasSessionMessage(context.sessionId, source.messageId)) {
        this.extras.delete(source.messageId)
        for (const [id, tool] of this.pendingTools)
          if (tool.messageId === source.messageId) this.pendingTools.delete(id)
      }
    }
  }

  checkpoint(uncommitted: ReadonlySet<string> = new Set()): RootProjectionCheckpoint {
    this.syncRemoved()
    const offsets = new Map<string, number>()
    const sources: RootProjectionCheckpoint['root']['sources'] = {}
    for (const [id, source] of this.sources) {
      if (uncommitted.has(source.messageId)) continue
      const offset = offsets.get(source.messageId) ?? 0
      sources[id] = { messageId: source.messageId, offset, count: source.parts.length }
      offsets.set(source.messageId, offset + source.parts.length)
    }
    return { contextId: this.contextId, root: { version: 2, sources, removed: [...this.removed] } }
  }
}
