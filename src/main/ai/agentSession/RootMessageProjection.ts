import { isDeepStrictEqual } from 'node:util'

import { isToolUIPart } from 'ai'
import { omit } from 'es-toolkit'

import {
  agentSessionContextService as contexts,
  type RootProjectionCheckpoint
} from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import type { RuntimeMessageProjection } from '@main/ai/runtime/types'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'

type Source = { messageId: string; parts: CherryUIMessage['parts'] }

/** Groups native sources into product replies; selected model context never deletes retained sources. */
export class RootMessageProjection {
  private readonly sources = new Map<string, Source>()
  private readonly removed = new Set<string>()
  private readonly extras = new Map<string, CherryUIMessage['parts']>()

  constructor(readonly contextId: string) {
    const context = contexts.context(contextId)
    const saved = context.checkpointMapping?.root as RootProjectionCheckpoint['root'] | undefined
    for (const id of saved?.removed ?? []) this.removed.add(id)
    const bodies = new Map<string, CherryUIMessage['parts']>()
    for (const [id, range] of Object.entries(saved?.sources ?? {})) {
      let parts = bodies.get(range.messageId)
      if (!parts) {
        parts = messages.getSessionMessage(context.sessionId, range.messageId).data.parts ?? []
        bodies.set(range.messageId, parts)
      }
      this.sources.set(id, { messageId: range.messageId, parts: parts.slice(range.offset, range.offset + range.count) })
    }
    for (const [messageId, parts] of bodies) {
      const ranges = Object.values(saved!.sources).filter((range) => range.messageId === messageId)
      this.extras.set(
        messageId,
        parts.filter((_, index) => !ranges.some((range) => index >= range.offset && index < range.offset + range.count))
      )
    }
  }

  accept(update: RuntimeMessageProjection, currentMessageId?: string): Map<string, CherryUIMessage['parts']> {
    const changed = new Set<string>()
    for (const id of update.removed) {
      this.removed.add(id)
      const previous = this.sources.get(id)
      if (previous) changed.add(previous.messageId)
      this.sources.delete(id)
    }
    for (const [old, replacement] of Object.entries(update.replaces)) {
      const previous = this.sources.get(old)
      if (!previous) continue
      const ordered = [...this.sources].map(([id, value]) => [id === old ? replacement : id, value] as const)
      this.sources.clear()
      for (const [id, value] of ordered) this.sources.set(id, value)
      this.removed.add(old)
    }
    const live = new Set(update.live)
    for (const message of update.messages) {
      if (message.role !== 'assistant' || this.removed.has(message.id)) continue
      const previous = this.sources.get(message.id)
      if (previous && !live.has(message.id)) continue
      const owner = previous?.messageId ?? (live.has(message.id) ? currentMessageId : undefined)
      if (!owner) continue
      if (!this.extras.has(owner)) this.extras.set(owner, [])
      if (!isDeepStrictEqual(previous?.parts, message.parts)) changed.add(owner)
      this.sources.set(message.id, { messageId: owner, parts: message.parts })
    }
    return new Map([...changed].map((id) => [id, this.parts(id)!]))
  }

  parts(messageId: string): CherryUIMessage['parts'] | undefined {
    const sources = [...this.sources.values()].filter((source) => source.messageId === messageId)
    if (!sources.length && !this.extras.has(messageId)) return undefined
    return [...sources.flatMap((source) => source.parts), ...(this.extras.get(messageId) ?? [])]
  }

  taskEvent(data: AgentTaskEventPartData): { messageId: string; parts: CherryUIMessage['parts'] } | undefined {
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
    const previous = extras.find((part) => part.type === next.type && part.data.taskId === data.taskId)
    if (isDeepStrictEqual(previous, next)) return undefined
    this.extras.set(owner.messageId, [
      ...extras.filter((part) => part.type !== next.type || part.data.taskId !== data.taskId),
      next
    ])
    return { messageId: owner.messageId, parts: this.parts(owner.messageId)! }
  }

  /** Retains host display state before late task updates reuse the settled message. */
  retain(message: CherryUIMessage): void {
    let offset = 0
    for (const source of this.sources.values()) {
      if (source.messageId !== message.id) continue
      const count = source.parts.length
      source.parts = message.parts.slice(offset, offset + count)
      offset += count
    }
    this.extras.set(message.id, message.parts.slice(offset))
  }

  checkpoint(): RootProjectionCheckpoint {
    const offsets = new Map<string, number>()
    const sources: RootProjectionCheckpoint['root']['sources'] = {}
    for (const [id, source] of this.sources) {
      const offset = offsets.get(source.messageId) ?? 0
      sources[id] = { messageId: source.messageId, offset, count: source.parts.length }
      offsets.set(source.messageId, offset + source.parts.length)
    }
    return { contextId: this.contextId, root: { sources, removed: [...this.removed] } }
  }
}
