import { isDeepStrictEqual } from 'node:util'

import { isDataUIPart, isToolUIPart, type UIMessageChunk } from 'ai'
import { omit } from 'es-toolkit'

import {
  agentSessionContextService as contexts,
  type RootProjectionCheckpoint
} from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import type { RuntimeMessageProjection } from '@main/ai/runtime/types'
import { dropEmptyContentParts, finalizeInterruptedParts, stripTransientStatusParts } from '@main/ai/streamManager'
import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'

type Source = { messageId: string; parts: CherryUIMessage['parts'] }

/** Groups native sources into product replies; selected model context never deletes retained sources. */
export class RootMessageProjection {
  private readonly sources = new Map<string, Source>()
  private readonly replySources = new Map<string, Set<string>>()
  private readonly removed = new Set<string>()
  private readonly extras = new Map<string, CherryUIMessage['parts']>()
  private readonly pendingTools = new Map<
    string,
    { messageId: string; input?: Extract<UIMessageChunk, { type: 'tool-input-available' }>; approvalId?: string }
  >()

  constructor(readonly contextId: string) {
    const context = contexts.context(contextId)
    const saved = context.checkpointMapping?.root
    for (const id of saved?.removed ?? []) this.removed.add(id)
    const bodies = new Map<string, CherryUIMessage['parts']>()
    const ranges = new Map<string, { offset: number; count: number }[]>()
    for (const [id, range] of Object.entries(saved?.sources ?? {})) {
      if (this.removed.has(id) || !messages.hasSessionMessage(context.sessionId, range.messageId)) {
        this.removed.add(id)
        continue
      }
      let parts = bodies.get(range.messageId)
      if (!parts) {
        parts = messages.getSessionMessage(context.sessionId, range.messageId).data.parts ?? []
        bodies.set(range.messageId, parts)
      }
      this.sources.set(id, { messageId: range.messageId, parts: parts.slice(range.offset, range.offset + range.count) })
      const owned = ranges.get(range.messageId) ?? []
      owned.push(range)
      ranges.set(range.messageId, owned)
    }
    this.indexSources()
    for (const [messageId, parts] of bodies) {
      this.extras.set(
        messageId,
        parts.filter(
          (_, index) =>
            !ranges.get(messageId)!.some((range) => index >= range.offset && index < range.offset + range.count)
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
      const ordered = [...this.sources].flatMap(([key, value]) =>
        key === first
          ? [[id, { messageId: owner, parts: message.parts }] as const]
          : old.includes(key)
            ? []
            : [[key, value] as const]
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
      if (!isDeepStrictEqual(previous?.parts, message.parts)) changed.add(owner)
      this.sources.set(message.id, { messageId: owner, parts: message.parts })
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
    const sources = [...(this.replySources.get(messageId) ?? [])].map((id) => this.sources.get(id)!)
    if (!sources.length && !this.extras.has(messageId)) return undefined
    const parts = sources.flatMap((source) => source.parts).map((part) => this.decorate(part))
    return [...parts, ...this.pendingParts(messageId, parts), ...(this.extras.get(messageId) ?? [])]
  }

  toolCallMessageId(toolCallId: string): string | undefined {
    this.syncRemoved()
    return [...this.sources.values()].find((source) =>
      source.parts.some((part) => isToolUIPart(part) && part.toolCallId === toolCallId)
    )?.messageId
  }

  get lastMessageId(): string | undefined {
    this.syncRemoved()
    return [...this.sources.values()].at(-1)?.messageId
  }

  private pendingParts(messageId: string, sources: CherryUIMessage['parts']): CherryUIMessage['parts'] {
    const parts: CherryUIMessage['parts'] = []
    for (const [toolCallId, pending] of this.pendingTools) {
      if (pending.messageId !== messageId || !pending.input || !pending.approvalId) continue
      if (sources.some((part) => isToolUIPart(part) && part.toolCallId === toolCallId)) continue
      parts.push({
        type: 'dynamic-tool',
        toolCallId,
        toolName: pending.input.toolName,
        input: pending.input.input,
        providerExecuted: pending.input.providerExecuted,
        state: 'approval-requested',
        approval: { id: pending.approvalId }
      })
    }
    return parts
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
      this.extras.set(messageId, [
        ...extras.filter(
          (previous) => !isDataUIPart(previous) || previous.type !== part.type || previous.id !== part.id
        ),
        part
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
    if (!data.toolUseId) return undefined
    const messageId = this.toolCallMessageId(data.toolUseId)
    if (!messageId) return undefined
    const extras = this.extras.get(messageId) ?? []
    const next = {
      type: 'data-agent-task-event' as const,
      id: `task-${data.taskId}`,
      data: omit(data, ['summary', 'prompt', 'outputFile'])
    }
    const previous = extras.find((part) => part.type === next.type && part.data.taskId === data.taskId)
    if (isDeepStrictEqual(previous, next)) return undefined
    this.extras.set(messageId, [
      ...extras.filter((part) => part.type !== next.type || part.data.taskId !== data.taskId),
      next
    ])
    return { messageId, parts: this.parts(messageId)! }
  }

  /** Normalize each owned source before flattening so checkpoint ranges describe the saved body. */
  prepare(message: CherryUIMessage, status: 'success' | 'paused' | 'error'): CherryUIMessage {
    for (const part of message.parts) {
      if (part.type === 'data-error') this.control(message.id, part)
    }
    const normalize = (parts: CherryUIMessage['parts']) =>
      finalizeInterruptedParts(dropEmptyContentParts(stripTransientStatusParts(parts)), status)
    const sourceParts = [...(this.replySources.get(message.id) ?? [])].flatMap((id) => this.sources.get(id)!.parts)
    const pending = this.pendingParts(message.id, sourceParts)
    for (const id of this.replySources.get(message.id) ?? []) {
      const source = this.sources.get(id)!
      source.parts = normalize(source.parts.map((part) => this.decorate(part)))
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
