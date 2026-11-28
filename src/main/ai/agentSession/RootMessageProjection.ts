import { isDeepStrictEqual } from 'node:util'

import { isDataUIPart, isToolUIPart, type UIMessageChunk } from 'ai'
import { omit } from 'es-toolkit'
import { v7 as uuidv7 } from 'uuid'

import { applyRuntimePartEdit, partEdits, type LivePartInput, type RuntimePartEdit } from '@cherrystudio/agent-runtime'
import {
  agentSessionContextService as contexts,
  type RootProjectionCheckpoint
} from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import type { AgentControlChunk, AgentRuntimeEvent, RuntimeMessageProjection } from '@main/ai/runtime/types'
import {
  type AgentPartChange,
  dropEmptyContentParts,
  type ExecutionPart,
  finalizeInterruptedParts,
  stripTransientStatusParts
} from '@main/ai/streamManager'
import { orderAgentTimelineParts } from '@main/utils/agentTimelineOrder'
import { updatedPartValue } from '@shared/ai/messageProjection'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'

type Part = CherryUIMessage['parts'][number]
type HostDataPart = Extract<Part, { type: `data-${string}` }>
type PartIdentity = Pick<ExecutionPart, 'partId' | 'pos'>
type AdmittedPartIdentity = PartIdentity & { readonly pos: number }
type AcceptedRootPart<P extends AgentPartChange = AgentPartChange> = {
  messageId: string
  patch: P
  completed?: ExecutionPart
}
type PartFacts = { type: string; toolCallId?: string; dataId?: string }
type SourcePart = PartIdentity & { value: { kind: 'live'; payload: Part } | { kind: 'stored'; facts: PartFacts } }
type ActiveSource = { messageId: string; entries: SourcePart[] }
type Source = ActiveSource | RootProjectionCheckpoint['root']['sources'][string]

function partFacts(part: Part): PartFacts {
  return {
    type: part.type,
    ...(isToolUIPart(part) && { toolCallId: part.toolCallId }),
    ...(isDataUIPart(part) && part.id !== undefined && { dataId: part.id })
  }
}

function sourcePartFacts({ value }: SourcePart): PartFacts {
  return value.kind === 'live' ? partFacts(value.payload) : value.facts
}

const TERMINAL_TOOL_STATES: ReadonlySet<string> = new Set(['output-available', 'output-error', 'output-denied'])

/** A part reaches its own semantic completion independently of the reply that contains it. */
function isPartDone(part: Part): boolean {
  if (part.type === 'text' || part.type === 'reasoning') return part.state !== 'streaming' && part.text.trim() !== ''
  if (isToolUIPart(part))
    return TERMINAL_TOOL_STATES.has(part.state) && !(part.state === 'output-available' && part.preliminary)
  if (part.type === 'data-compaction-anchor') return part.data.status === 'done'
  if (part.type === 'data-agent-task-event') return part.data.status !== 'in_progress'
  return part.type !== 'data-retry'
}

/** Groups native sources into product replies; selected model context never deletes retained sources. */
export class RootMessageProjection {
  private readonly retiredToolApprovals = new Set<string>()
  private readonly approvals = new Map<string, { id: string; approved: boolean }>()
  private readonly sources = new Map<string, Source>()
  private readonly replySources = new Map<string, Set<string>>()
  private readonly removed = new Set<string>()
  private readonly extras = new Map<string, SourcePart[]>()
  private readonly toolIds = new Map<string, { messageId: string; identity: PartIdentity }>()
  private readonly liveParts = new Map<string, SourcePart>()
  private readonly committedValues = new WeakSet<Part>()
  private readonly sessionId: string
  private readonly pendingTools = new Map<
    string,
    { messageId: string; input?: Extract<UIMessageChunk, { type: 'tool-input-available' }>; approvalId?: string }
  >()

  /** Product input of the latest native user message; later answers without an owner belong to it. */
  private answering?: string

  /** `answerOwner` names the reply that still takes native answers to an input, if any. */
  constructor(
    readonly contextId: string,
    private readonly timeline: { lastPos: number },
    private readonly answerOwner: (inputId: string) => string | undefined = () => undefined
  ) {
    const context = contexts.context(contextId)
    this.sessionId = context.sessionId
    const saved = context.checkpointMapping?.root
    for (const id of saved?.removed ?? []) this.removed.add(id)
    for (const [id, range] of Object.entries(saved?.sources ?? {})) {
      if (!this.removed.has(id)) this.sources.set(id, range)
    }
    this.indexSources()
  }

  /** All native sources of a reply share the same stored body and are restored together. */
  private archivedSources(messageId: string): Set<string> | undefined {
    const ids = this.replySources.get(messageId)
    for (const id of ids ?? []) {
      const source = this.sources.get(id)
      if (source) return 'entries' in source ? undefined : ids
    }
    return undefined
  }

  private restoreReply(messageId: string): boolean {
    const ids = this.archivedSources(messageId)
    if (!ids) return true
    if (!messages.hasSessionMessage(this.sessionId, messageId)) {
      for (const id of ids) {
        this.removed.add(id)
        this.sources.delete(id)
      }
      this.replySources.delete(messageId)
      return false
    }
    const body = messages.getStoredMessagePartFacts(this.sessionId, messageId).map((part): SourcePart => {
      const { partId, pos, type, toolCallId, dataId, state, approvalId, approved, taskToolUseId, taskStatus } = part
      if (taskToolUseId && (taskStatus === 'completed' || taskStatus === 'stopped' || taskStatus === 'error'))
        this.retiredToolApprovals.add(taskToolUseId)
      if (toolCallId) {
        this.toolIds.set(toolCallId, { messageId, identity: { partId, pos } })
        if (state === 'approval-requested') this.retiredToolApprovals.delete(toolCallId)
        if (approvalId && approved !== null && !this.approvals.has(toolCallId))
          this.approvals.set(toolCallId, { id: approvalId, approved: approved === 1 })
      }
      return {
        partId,
        pos,
        value: { kind: 'stored', facts: { type, toolCallId: toolCallId ?? undefined, dataId: dataId ?? undefined } }
      }
    })
    const byId = new Map(body.map((slot) => [slot.partId, slot]))
    const extras = new Set(body)
    for (const id of ids) {
      const range = this.sources.get(id)!
      if ('entries' in range) continue
      const entries =
        'partIds' in range
          ? range.partIds.flatMap((id) => byId.get(id) ?? [])
          : body.slice(range.offset, range.offset + range.count)
      for (const entry of entries) extras.delete(entry)
      this.sources.set(id, { messageId, entries })
    }
    this.extras.set(messageId, [...extras])
    return true
  }

  private activeSource(id: string): ActiveSource | undefined {
    let source = this.sources.get(id)
    if (source && !('entries' in source)) {
      this.restoreReply(source.messageId)
      source = this.sources.get(id)
    }
    return source && 'entries' in source ? source : undefined
  }

  accept(update: RuntimeMessageProjection, currentMessageId?: string): Map<string, readonly ExecutionPart[]> {
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
      if (!this.restoreReply(owner)) {
        this.removed.add(id)
        continue
      }
      const first = old[0]
      const previous = old.flatMap((key) => this.activeSource(key)!.entries)
      const merged = { messageId: owner, entries: this.sourceEntries(owner, previous, message.parts) }
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
      const previous = this.activeSource(id)
      if (previous) {
        changed.add(previous.messageId)
        this.replySources.get(previous.messageId)?.delete(id)
        for (const { partId } of previous.entries) this.liveParts.delete(partId)
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
      if (message.role === 'user') this.answering = update.inputs?.[message.id]
      if (message.role !== 'assistant' || this.removed.has(message.id)) continue
      const previous = this.sources.get(message.id)
      if (previous && !live.has(message.id) && !refresh.has(message.id)) continue
      const owner =
        previous?.messageId ??
        (live.has(message.id) ? currentMessageId : undefined) ??
        (this.answering ? this.answerOwner(this.answering) : undefined)
      if (!owner || !this.restoreReply(owner)) continue
      if (!this.extras.has(owner)) this.extras.set(owner, [])
      const before = this.activeSource(message.id)?.entries
      const entries = this.sourceEntries(owner, before, message.parts)
      if (before?.length !== entries.length || entries.some((part, index) => part !== before[index])) changed.add(owner)
      this.sources.set(message.id, { messageId: owner, entries })
      for (const part of message.parts) {
        if (!isToolUIPart(part)) continue
        if (part.state.startsWith('output-')) this.pendingTools.delete(part.toolCallId)
        this.extras.set(
          owner,
          this.extras.get(owner)!.filter((slot) => {
            if (sourcePartFacts(slot).toolCallId !== part.toolCallId) return true
            if (this.liveParts.get(slot.partId) === slot) this.liveParts.delete(slot.partId)
            return false
          })
        )
      }
      const sources = this.replySources.get(owner) ?? new Set<string>()
      sources.add(message.id)
      this.replySources.set(owner, sources)
    }
    return new Map([...changed].map((id) => [id, this.replyEntries(id) ?? []]))
  }

  parts(messageId: string): CherryUIMessage['parts'] | undefined {
    return this.replyEntries(messageId)?.map((entry) => entry.payload)
  }

  changeTerminal(event: Extract<AgentRuntimeEvent, { type: 'local-tool-terminal' }>): AcceptedRootPart[] {
    const source = this.activeSource(event.itemId)
    const slot = source?.entries[event.part]
    if (!source || slot?.value.kind !== 'live') return []
    const terminalPatch = { type: 'part-tool-terminal' as const, partId: slot.partId, delta: event.delta }
    const part = updatedPartValue(slot.value.payload, terminalPatch)
    if (part?.type !== 'dynamic-tool') return []
    slot.value.payload = part
    return [
      {
        messageId: source.messageId,
        patch: {
          type: 'part-put',
          archiveMessageId: source.messageId,
          partId: slot.partId,
          part,
          terminalPatch
        }
      }
    ]
  }

  changePart(event: LivePartInput): AcceptedRootPart[] {
    const source = this.activeSource(event.ref.id)
    if (!source) return []
    const { messageId, entries } = source
    const edits = partEdits(event)
    const staged = new Map<number, Part>()
    const changes: { edit: RuntimePartEdit; part: Part }[] = []
    let length = entries.length
    for (const edit of edits) {
      if (
        edit.type === 'put' &&
        edit.value.type === 'dynamic-tool' &&
        (edit.value.state === 'output-error' || edit.value.state === 'output-available') &&
        this.approvals.get(edit.value.toolCallId)?.approved === false
      )
        continue
      const index = edit.part
      if (!Number.isSafeInteger(index) || index < 0 || index > length) return []
      const slot = entries[index]
      if (slot?.value.kind === 'stored' && edit.type !== 'put' && edit.type !== 'correct') return []
      const current = staged.get(index) ?? (slot && this.readPart(messageId, slot))
      const part = applyRuntimePartEdit(current, edit) as Part | undefined
      if (!part) return []
      staged.set(index, part)
      changes.push({ edit, part })
      if (index === length) length++
    }
    return changes.map(({ edit, part }) => {
      const entry = entries[edit.part]
      const toolId = isToolUIPart(part) ? part.toolCallId : undefined
      const known = entry ?? (toolId ? this.toolIds.get(toolId)?.identity : undefined)
      const { identity, placement } = this.admit(messageId, known)
      const { partId } = identity
      if (placement && toolId) this.toolIds.set(toolId, { messageId, identity })
      let patch: AgentPartChange
      switch (edit.type) {
        case 'open':
          if (!placement) throw new Error('Cannot open an existing part')
          patch = {
            type: 'part-open',
            ...placement,
            partId,
            kind: edit.kind,
            ...(edit.providerMetadata && { providerMetadata: edit.providerMetadata })
          }
          break
        case 'append':
          patch = { type: 'part-append', partId, text: edit.text }
          break
        case 'finish':
          patch = {
            type: 'part-finish',
            partId,
            ...(edit.providerMetadata && { providerMetadata: edit.providerMetadata })
          }
          break
        case 'correct':
          if (part.type !== 'text' && part.type !== 'reasoning') throw new Error('Invalid text correction')
          patch = { type: 'part-correct', partId, part }
          break
        case 'put': {
          const value = this.decorate(part)
          if (value.type === 'text' || value.type === 'reasoning') throw new Error('Invalid non-text part')
          if (isToolUIPart(value) && value.state.startsWith('output-')) this.pendingTools.delete(value.toolCallId)
          patch = {
            archiveMessageId: messageId,
            partId,
            part: value,
            ...(placement ? { type: 'part-add', placement } : { type: 'part-put' })
          }
          break
        }
      }
      if (entry?.value.kind === 'live') entry.value.payload = part
      else entries[edit.part] = this.ownPart(identity, part)
      const completed = isPartDone(part)
        ? {
            partId,
            pos: identity.pos,
            payload: patch.type === 'part-add' || patch.type === 'part-put' ? patch.part : part
          }
        : undefined
      return { messageId, patch, completed }
    })
  }

  private decorateExtra(part: CherryUIMessage['parts'][number]): CherryUIMessage['parts'][number] {
    return isToolUIPart(part) &&
      this.retiredToolApprovals.has(part.toolCallId) &&
      part.state !== 'output-available' &&
      part.state !== 'output-error' &&
      part.state !== 'output-denied'
      ? { ...part, state: 'input-available', approval: undefined }
      : part
  }

  toolCallMessageId(toolCallId: string): string | undefined {
    this.syncRemoved()
    const known = this.toolIds.get(toolCallId)
    if (known) {
      const matches = (slot: SourcePart) => slot.partId === known.identity.partId
      for (const id of this.replySources.get(known.messageId) ?? []) {
        if (this.activeSource(id)?.entries.some(matches)) return known.messageId
      }
      if (this.extras.get(known.messageId)?.some(matches)) return known.messageId
    }
    const pending = this.pendingTools.get(toolCallId)
    if (pending) return pending.messageId
    for (const { messageId } of messages.findStoredToolOwners(this.sessionId, toolCallId)) {
      if (this.archivedSources(messageId) && this.restoreReply(messageId)) return messageId
    }
    return undefined
  }

  get lastMessageId(): string | undefined {
    this.syncRemoved()
    for (const source of [...this.sources.values()].reverse()) {
      if ('entries' in source || messages.hasSessionMessage(this.sessionId, source.messageId)) return source.messageId
    }
    return undefined
  }

  partPlacement(messageId: string): { partIds: string[]; positions: ReadonlyMap<string, number> } | undefined {
    const entries = this.replyEntries(messageId)
    if (!entries) return
    return {
      partIds: entries.map(({ partId }) => partId),
      positions: new Map(entries.flatMap(({ partId, pos }) => (pos === null ? [] : [[partId, pos]])))
    }
  }

  /** Completed parts whose content differs from their last save, with the reply's current part order. */
  completions(entries: readonly ExecutionPart[]): {
    order: string[]
    parts: Map<string, Part>
    positions?: ReadonlyMap<string, number>
  } {
    const parts = new Map<string, Part>()
    let positions: Map<string, number> | undefined
    for (const { partId, payload: part, pos } of entries) {
      if (!isPartDone(part) || this.committedValues.has(part)) continue
      parts.set(partId, part)
      if (pos !== null) (positions ??= new Map()).set(partId, pos)
    }
    return { order: entries.map((entry) => entry.partId), parts, ...(positions && { positions }) }
  }

  /** Releases a committed source value after SQLite can serve it. */
  committed(parts: ReadonlyMap<string, Part>): void {
    for (const [id, part] of parts) {
      const slot = this.liveParts.get(id)
      if (slot) this.releasePart(slot)
      else this.committedValues.add(part)
    }
  }

  committedReply(messageId: string): void {
    for (const sourceId of this.replySources.get(messageId) ?? []) {
      const source = this.sources.get(sourceId)
      if (source && 'entries' in source) for (const slot of source.entries) this.releasePart(slot)
    }
    for (const slot of this.extras.get(messageId) ?? []) this.releasePart(slot)
  }

  private releasePart(slot: SourcePart): void {
    if (slot.value.kind === 'stored') return
    slot.value = { kind: 'stored', facts: partFacts(slot.value.payload) }
    this.liveParts.delete(slot.partId)
  }

  replyEntries(messageId: string): readonly ExecutionPart[] | undefined {
    this.syncRemoved()
    if (!this.restoreReply(messageId)) return undefined
    const sources = [...(this.replySources.get(messageId) ?? [])].map((id) => this.activeSource(id)!)
    if (!sources.length && !this.extras.has(messageId)) return undefined
    const slots = sources.flatMap((source) => source.entries)
    const read = this.sourcePartReader(messageId)
    const project = (entry: SourcePart, decorate: (part: Part) => Part): ExecutionPart[] => {
      const part = read(entry)
      if (!part) return []
      const payload = decorate(part)
      if (entry.value.kind === 'stored' && isDeepStrictEqual(part, payload)) this.committedValues.add(payload)
      return [{ partId: entry.partId, pos: entry.pos, payload }]
    }
    const entries = slots.flatMap((slot) => project(slot, (part) => this.decorate(part)))
    const extras = (this.extras.get(messageId) ?? []).flatMap((entry) =>
      project(entry, (part) => this.decorateExtra(part))
    )
    const parts = [...entries, ...extras]
    parts.push(...this.pendingParts(messageId, parts))
    return orderAgentTimelineParts(parts, () => messages.getStoredMessagePartFacts(this.sessionId, messageId))
  }

  private sourcePartReader(messageId: string): (slot: SourcePart) => Part | undefined {
    let stored: Map<string, Part> | undefined
    return (slot) => {
      if (slot.value.kind === 'live') return slot.value.payload
      stored ??= new Map(
        messages.getStoredMessageParts(this.sessionId, messageId).map(({ partId, payload }) => [partId, payload])
      )
      return stored.get(slot.partId)
    }
  }

  private readPart(messageId: string, slot: SourcePart): Part | undefined {
    return slot.value.kind === 'live'
      ? slot.value.payload
      : messages.getStoredMessagePart(this.sessionId, messageId, slot.partId)
  }

  private ownPart({ partId, pos }: PartIdentity, payload: Part): SourcePart {
    const slot: SourcePart = { partId, pos, value: { kind: 'live', payload } }
    this.liveParts.set(partId, slot)
    return slot
  }

  private sourceEntries(
    messageId: string,
    previous: readonly SourcePart[] | undefined,
    parts: readonly Part[]
  ): SourcePart[] {
    let dataIds: Map<string, PartIdentity> | undefined
    const known = new Map(previous?.map((slot) => [slot.partId, slot]))
    const read = this.sourcePartReader(messageId)
    const accept = (identity: PartIdentity, payload: Part): SourcePart => {
      const slot = known.get(identity.partId)
      known.delete(identity.partId)
      if (slot) {
        const before = read(slot)
        if (before === payload || (slot.value.kind === 'stored' && isDeepStrictEqual(before, payload))) return slot
      }
      return this.ownPart(identity, payload)
    }
    const entries = parts.map((part, index) => {
      if (isToolUIPart(part)) return accept(this.toolIdentity(messageId, part.toolCallId), part)
      if (isDataUIPart(part) && part.id !== undefined) {
        if (!dataIds) {
          dataIds = new Map()
          for (const entry of previous ?? []) {
            const { type, dataId } = sourcePartFacts(entry)
            if (dataId !== undefined) dataIds.set(JSON.stringify([type, dataId]), entry)
          }
        }
        const identity = dataIds.get(JSON.stringify([part.type, part.id])) ?? this.newIdentity()
        return accept(identity, part)
      }
      const before = previous?.[index]
      const facts = before && sourcePartFacts(before)
      return accept(
        before && facts?.type === part.type && !facts.toolCallId && facts.dataId === undefined
          ? before
          : this.newIdentity(),
        part
      )
    })
    for (const [partId, slot] of known) if (this.liveParts.get(partId) === slot) this.liveParts.delete(partId)
    return entries
  }

  private newIdentity(): AdmittedPartIdentity {
    return { partId: uuidv7(), pos: ++this.timeline.lastPos }
  }

  private admit(messageId: string, existing?: PartIdentity) {
    if (existing) return { identity: existing, placement: undefined }
    const identity = this.newIdentity()
    return { identity, placement: { messageId, pos: identity.pos } }
  }

  private toolIdentity(messageId: string, toolCallId: string): PartIdentity {
    const known = this.toolIds.get(toolCallId)
    if (known) return known.identity
    const identity = this.newIdentity()
    this.toolIds.set(toolCallId, { messageId, identity })
    return identity
  }

  private pendingParts(messageId: string, sources: readonly ExecutionPart[]): ExecutionPart[] {
    const entries: ExecutionPart[] = []
    for (const [toolCallId, pending] of this.pendingTools) {
      if (
        pending.messageId !== messageId ||
        !pending.input ||
        (!pending.approvalId && !this.retiredToolApprovals.has(toolCallId))
      )
        continue
      if (sources.some(({ payload }) => isToolUIPart(payload) && payload.toolCallId === toolCallId)) continue
      entries.push({
        ...this.toolIds.get(toolCallId)!.identity,
        payload: this.decorate({
          type: 'dynamic-tool',
          toolCallId,
          toolName: pending.input.toolName,
          input: pending.input.input,
          providerExecuted: pending.input.providerExecuted,
          callProviderMetadata: pending.input.providerMetadata,
          ...(pending.approvalId
            ? { state: 'approval-requested' as const, approval: { id: pending.approvalId } }
            : { state: 'input-available' as const })
        })
      })
    }
    return entries
  }

  control(
    messageId: string,
    chunk: Exclude<AgentControlChunk, { type: 'start' | 'message-metadata' }>
  ): 'reconcile' | AcceptedRootPart | false {
    if ('transient' in chunk && chunk.transient) return false
    if (!this.restoreReply(messageId)) return false
    if (chunk.type === 'tool-input-available' || chunk.type === 'tool-approval-request') {
      if (!this.extras.has(messageId)) this.extras.set(messageId, [])
      if (chunk.type === 'tool-approval-request') {
        if (this.approvals.get(chunk.toolCallId)?.id !== chunk.approvalId) this.approvals.delete(chunk.toolCallId)
        this.retiredToolApprovals.delete(chunk.toolCallId)
        this.extras.set(
          messageId,
          this.extras.get(messageId)!.map((entry) => {
            if (sourcePartFacts(entry).toolCallId !== chunk.toolCallId) return entry
            const part = this.readPart(messageId, entry)
            if (
              !part ||
              !isToolUIPart(part) ||
              part.state === 'output-available' ||
              part.state === 'output-error' ||
              part.state === 'output-denied'
            )
              return entry
            return this.ownPart(entry, { ...part, state: 'approval-requested', approval: { id: chunk.approvalId } })
          })
        )
      }
      const pending = this.pendingTools.get(chunk.toolCallId) ?? { messageId }
      const input = chunk.type === 'tool-input-available' ? chunk : pending.input
      if (
        input &&
        (chunk.type === 'tool-approval-request' ||
          pending.approvalId ||
          this.retiredToolApprovals.has(chunk.toolCallId))
      )
        this.toolIdentity(messageId, chunk.toolCallId)
      this.pendingTools.set(chunk.toolCallId, {
        ...pending,
        ...(chunk.type === 'tool-input-available' ? { input: chunk } : { approvalId: chunk.approvalId })
      })
    } else if (chunk.type === 'data-compaction-anchor' && chunk.id === undefined) {
      return this.addDataPart(messageId, chunk)
    } else {
      return this.putDataPart(messageId, chunk)
    }
    return 'reconcile'
  }

  private addDataPart(
    messageId: string,
    part: HostDataPart
  ): AcceptedRootPart<Extract<AgentPartChange, { type: 'part-add' }>> {
    const identity = this.newIdentity()
    const slot = this.ownPart(identity, part)
    const extras = this.extras.get(messageId)
    if (extras) extras.push(slot)
    else this.extras.set(messageId, [slot])
    return {
      messageId,
      patch: {
        type: 'part-add',
        placement: { messageId, pos: identity.pos },
        archiveMessageId: messageId,
        partId: identity.partId,
        part
      },
      completed: isPartDone(part) ? { ...identity, payload: part } : undefined
    }
  }

  private putDataPart(messageId: string, part: HostDataPart): AcceptedRootPart {
    const previous = this.extras.get(messageId)?.find((entry) => {
      const { type, dataId } = sourcePartFacts(entry)
      return type === part.type && dataId === part.id
    })
    if (!previous) return this.addDataPart(messageId, part)
    previous.value = { kind: 'live', payload: part }
    this.liveParts.set(previous.partId, previous)
    return {
      messageId,
      patch: { type: 'part-put', archiveMessageId: messageId, partId: previous.partId, part },
      completed: isPartDone(part) ? { partId: previous.partId, pos: previous.pos, payload: part } : undefined
    }
  }

  resolveToolApproval(toolCallId: string, approvalId: string, approved: boolean): void {
    this.approvals.set(toolCallId, { id: approvalId, approved })
  }

  isPendingToolApproval(toolCallId: string, approvalId: string): boolean {
    return this.pendingTools.get(toolCallId)?.approvalId === approvalId
  }

  retireToolApproval(toolCallId: string): boolean {
    if (!this.toolCallMessageId(toolCallId)) return false
    const pending = this.pendingTools.get(toolCallId)
    if (this.approvals.has(toolCallId) || this.retiredToolApprovals.has(toolCallId)) return false
    this.retiredToolApprovals.add(toolCallId)
    if (pending) {
      if (pending.input) this.toolIdentity(pending.messageId, toolCallId)
      delete pending.approvalId
    }
    return true
  }

  private decorate(part: CherryUIMessage['parts'][number]): CherryUIMessage['parts'][number] {
    if (!isToolUIPart(part)) return part
    const approval = this.approvals.get(part.toolCallId)
    if (approval) {
      if (!approval.approved) {
        return {
          ...part,
          state: 'output-denied',
          output: undefined,
          errorText: undefined,
          approval: { ...approval, approved: false }
        }
      }
      if (part.state === 'output-denied') return part
      const allowed = { ...approval, approved: true as const }
      return part.state === 'output-available' || part.state === 'output-error'
        ? { ...part, approval: allowed }
        : { ...part, state: 'approval-responded', approval: allowed }
    }
    if (part.state === 'output-available' || part.state === 'output-error' || part.state === 'output-denied')
      return part
    if (part.approval?.approved !== undefined) return part
    if (this.retiredToolApprovals.has(part.toolCallId)) {
      return {
        ...part,
        state: 'input-available',
        approval: undefined,
        input: this.pendingTools.get(part.toolCallId)?.input?.input ?? part.input
      }
    }
    const pending = this.pendingTools.get(part.toolCallId)
    if (!pending?.approvalId) return part
    return {
      ...part,
      state: 'approval-requested',
      approval: { id: pending.approvalId },
      input: pending.input?.input ?? part.input,
      callProviderMetadata: pending.input?.providerMetadata ?? part.callProviderMetadata
    }
  }

  taskEvent(data: AgentTaskEventPartData): string | undefined {
    if (!data.toolUseId) return undefined
    const messageId = this.toolCallMessageId(data.toolUseId)
    if (!messageId) return undefined
    const extras = this.extras.get(messageId) ?? []
    const next = {
      type: 'data-agent-task-event' as const,
      id: `task-${data.taskId}`,
      data: omit(data, ['summary', 'prompt', 'outputFile'])
    }
    const same = (entry: SourcePart) => sourcePartFacts(entry).dataId === next.id
    const previous = extras.find(same)
    if (previous && isDeepStrictEqual(this.readPart(messageId, previous), next)) return undefined
    this.extras.set(messageId, [
      ...extras.filter((entry) => !same(entry)),
      this.ownPart(previous ?? this.newIdentity(), next)
    ])
    return messageId
  }

  /** Normalize each owned source before saving its surviving part IDs. */
  prepare(message: CherryUIMessage, status: 'success' | 'paused' | 'error'): CherryUIMessage {
    if (!this.restoreReply(message.id)) return { ...message, parts: [] }
    for (const part of message.parts) {
      if (part.type === 'data-error') this.putDataPart(message.id, part)
    }
    // Each normalizer keeps, drops or rewrites one part at a time, so IDs follow their own part.
    const normalize = (entries: readonly ExecutionPart[]) =>
      entries.flatMap((entry) =>
        finalizeInterruptedParts(dropEmptyContentParts(stripTransientStatusParts([entry.payload])), status).map(
          (next) => ({
            ...entry,
            payload: next
          })
        )
      )
    const read = this.sourcePartReader(message.id)
    const sourceEntries: ExecutionPart[] = []
    const prepareParts = (slots: readonly SourcePart[], decorate: (part: Part) => Part) =>
      slots.flatMap((slot) => {
        const part = read(slot)
        if (!part) return []
        sourceEntries.push({ partId: slot.partId, pos: slot.pos, payload: part })
        const [entry] = normalize([{ partId: slot.partId, pos: slot.pos, payload: decorate(part) }])
        if (!entry) {
          this.liveParts.delete(slot.partId)
          return []
        }
        return [
          entry.payload === part || isDeepStrictEqual(entry.payload, part) ? slot : this.ownPart(slot, entry.payload)
        ]
      })
    for (const id of this.replySources.get(message.id) ?? []) {
      const source = this.activeSource(id)!
      source.entries = prepareParts(source.entries, (part) => this.decorate(part))
    }
    const extras = prepareParts(this.extras.get(message.id) ?? [], (part) => this.decorateExtra(part))
    const pending = normalize(this.pendingParts(message.id, sourceEntries))
    this.extras.set(message.id, [...pending.map((entry) => this.ownPart(entry, entry.payload)), ...extras])
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
    for (const id of contexts.removedRootSourceIds(this.contextId)) {
      this.removed.add(id)
      const source = this.sources.get(id)
      if (!source) continue
      this.sources.delete(id)
      this.replySources.get(source.messageId)?.delete(id)
      if ('entries' in source) for (const { partId } of source.entries) this.liveParts.delete(partId)
      if (!messages.hasSessionMessage(this.sessionId, source.messageId)) {
        for (const { partId } of this.extras.get(source.messageId) ?? []) this.liveParts.delete(partId)
        this.extras.delete(source.messageId)
        for (const [id, tool] of this.pendingTools)
          if (tool.messageId === source.messageId) this.pendingTools.delete(id)
      }
    }
  }

  checkpoint(uncommitted: ReadonlySet<string> = new Set()): RootProjectionCheckpoint {
    this.syncRemoved()
    const sources: RootProjectionCheckpoint['root']['sources'] = {}
    for (const [id, source] of this.sources) {
      if (uncommitted.has(source.messageId)) continue
      sources[id] =
        'entries' in source
          ? { messageId: source.messageId, partIds: source.entries.map((part) => part.partId) }
          : source
    }
    return { contextId: this.contextId, root: { version: 3, sources, removed: [...this.removed] } }
  }
}
