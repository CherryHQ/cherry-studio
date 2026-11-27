import { isDeepStrictEqual } from 'node:util'

import { v4 as uuid } from 'uuid'

import { application } from '@application'
import {
  isLivePartInput,
  partEdits,
  type LivePartInput,
  type RuntimeMessage,
  type Observation,
  type ObservationPayload,
  type Thread,
  type ThreadHandle
} from '@cherrystudio/agent-runtime'
import type { AgentSessionCheckpoints, AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import { MessageProjection } from '@main/ai/messages/MessageProjection'
import { projectAgentNonTextPart, type PublishedPartPatch } from '@main/utils/messageOutputProjection'
import type { AgentChildUpdate, AgentChildView } from '@shared/ai/agentChildProjection'
import { AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY } from '@shared/ai/agentSessionContextUsage'
import { buildAgentSessionTopicId } from '@shared/ai/agentSessionTopic'
import { updatedPartValue, type ChildProjectionState, type ChildPartPlacement } from '@shared/ai/messageProjection'
import { toolResultValue, type DeferredToolResultRef } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { RetryPartData } from '@shared/data/types/uiParts'

import {
  compose,
  invalidateRemovedResults,
  projectArchiveRow,
  savedChildView,
  savedMessages,
  storedEqual,
  type Composition,
  type ProjectedArchiveRow
} from './childArchive'
import { childTimelines } from './childTimelines'
import { markLocalInput } from './nativeSubmission'
import { ThreadMessageProjection, type MessageDecorator } from './ThreadMessageProjection'

const logger = loggerService.withContext('ChildThreadProjection')
type CommittedHistory = {
  responseIds?: Readonly<Record<string, string>>
  messages: readonly RuntimeMessage[]
  aliases: Readonly<Record<string, string>>
  removed?: readonly string[]
  legacy?: Readonly<Record<string, { readonly messageId: string; readonly parts: readonly number[] }>>
}
type ToolOutput = Extract<ObservationPayload, { type: 'message.tool-output' }>['tool']
/** One native child observer and archive writer, retained by the parent runtime owner. */
export class ChildThreadProjection {
  private readonly projection: ThreadMessageProjection
  private readonly unpublish: () => void
  private observation?: Observation
  private source?: object
  private contextVersion = 0
  private attaching?: Promise<void>
  private retryStatus?: Extract<RetryPartData, { state: 'retrying' }>
  private view: AgentChildView
  private readonly productIds = new Map<string, string>()
  private readonly committedLiveIds = new Set<string>()
  private readonly nativeIds: Record<string, string>
  private readonly saved = new Map<string, CherryUIMessage>()
  private readonly removed: Set<string>
  private readonly delivery: MessageProjection<ChildProjectionState>
  private timer?: ReturnType<typeof setTimeout>
  private pending: Promise<void> = Promise.resolve()
  private publishingArchive?: Promise<void>
  private stopped = false
  private needsHistory = true
  private reloadSaved = false
  private readonly archiveGap?: string
  private history?: CommittedHistory
  private canonicalIds = new Map<string, string>()
  private readonly composition: Composition
  private readonly materialized = new Map<
    string,
    { source: CherryUIMessage; id: string; rows: CherryUIMessage[]; partIds: string[]; fragments: Composition[string] }
  >()
  /** Native addresses changed while reading an older archive, indexed by stable product row and part position. */
  private archiveEdits?: Map<string, Map<number, string>>
  private readonly pendingResults = new Map<string, { messageId: string; part: ToolOutput }>()
  private readonly visibleParts = new Map<string, { messageId: string; value: CherryUIMessage['parts'][number] }>()
  private readonly changedParts = new Map<string, { messageId: string; placement?: { afterPartId?: string } }>()
  private renderedRows = new Map<string, ProjectedArchiveRow>()
  /** Committed history stays projected between rereads, so a reread redecorates only changed sources. */
  private committed?: ThreadMessageProjection
  private committedRefresh: Set<string> | true = new Set()
  private savedCheckpoint: ReturnType<typeof checkpointOf>
  private readonly reportedResponses = new Map<string, string>()

  constructor(
    readonly context: AgentSessionContextRow,
    private readonly handle: ThreadHandle,
    private readonly readCommitted: () => CommittedHistory | Promise<CommittedHistory>,
    private readonly decorate?: MessageDecorator,
    private readonly onResponse?: (responseId: string, messageId: string) => void,
    private readonly decorateLive?: (event: LivePartInput) => LivePartInput
  ) {
    this.projection = new ThreadMessageProjection(handle.thread, (message, source, unchangedParts) =>
      this.decorateMessage(message, source, unchangedParts)
    )
    this.removed = new Set(context.checkpointMapping?.child?.removed)
    this.nativeIds = { ...context.checkpointMapping?.child?.sources }
    this.composition = { ...context.checkpointMapping?.child?.composition }
    this.savedCheckpoint = checkpointOf(context.checkpointMapping?.child ?? {})
    const saved = savedMessages(context.sessionId)
    this.view = savedChildView(context, saved)
    this.indexVisibleParts(this.view.messages)
    this.delivery = new MessageProjection<ChildProjectionState>(this.view, (baseline) => this.captureLiveRows(baseline))
    this.archiveGap = this.view.diagnostic
    for (const message of saved) this.saved.set(message.id, message)
    this.unpublish = childTimelines.publish(context, this)
  }

  snapshot(): AgentChildView {
    return this.delivery.snapshot()
  }

  getToolResult(partId: string, toolCallId: string): { found: true; output: unknown } | undefined {
    const part = this.pendingResults.get(partId)?.part
    if (part && part.toolCallId === toolCallId) return { found: true, output: toolResultValue(part) }
    return undefined
  }

  subscribe(listener: (update: AgentChildUpdate) => void): () => void {
    return this.delivery.subscribe(listener)
  }

  attach(): Promise<void> {
    this.attaching ??= this.attachSource().finally(() => {
      this.attaching = undefined
    })
    return this.attaching
  }

  private async attachSource(): Promise<void> {
    if (this.stopped) throw new Error('Child projection is closed')
    if (this.source) return this.flush()
    await this.observation?.stop()
    await this.pending
    const source = {}
    this.source = source
    const result = await this.handle.observe(async (event) => {
      if (this.publishingArchive) await this.publishingArchive
      if (this.stopped || this.source !== source) return
      if (isLivePartInput(event)) {
        if (!this.sourceRow(event.ref.id)) await this.flush()
        const applied = this.applyParts(event)
        if (applied) {
          if (applied === 'persist') this.schedule()
          return
        }
      }
      if (event.type === 'context.changed') {
        this.contextVersion++
        application
          .get('CacheService')
          .setShared(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(this.context.sessionId), { result: event.result })
        return
      }
      if (event.type === 'snapshot' && event.contextUsage) {
        this.contextVersion++
        application
          .get('CacheService')
          .setShared(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(this.context.sessionId), { result: event.contextUsage })
      }
      if (event.type === 'input.changed') {
        const { input } = event
        if (
          input.inputId &&
          (!input.nativeInput ||
            (input.nativeInput.session.id === this.handle.thread.id &&
              input.nativeInput.session.backendId === this.handle.thread.backendId))
        ) {
          if (input.facts.includes('placed'))
            messages.saveInputTimelinePosition(this.context.sessionId, input.inputId, this.context.id)
          if (input.facts.includes('locally-handled'))
            markLocalInput(this.context.sessionId, this.context.id, input.inputId)
        }
        return
      }
      if (event.type === 'message.remove') this.removed.add(event.ref.id)
      if (event.type === 'message.reconcile') {
        for (const ref of event.replaces ?? []) {
          const id = this.nativeIds[ref.id] ?? this.productIds.get(ref.id)
          if (id) this.productIds.set(event.message.id, id)
          this.removed.add(ref.id)
        }
      }
      try {
        await this.projection.accept(event)
        if (event.type === 'subagent.upsert') return
      } catch (error) {
        this.source = undefined
        this.schedule()
        throw error
      }
      if (
        event.type === 'snapshot' ||
        event.type === 'gap' ||
        event.type === 'message.remove' ||
        (event.type === 'message.reconcile' && event.message.metadata?.completeness === 'complete') ||
        (event.type === 'message.parts' &&
          event.changes.some(
            (edit) =>
              edit.type === 'put' &&
              edit.value.type === 'dynamic-tool' &&
              edit.value.state.startsWith('output-') &&
              (edit.value.state !== 'output-available' || !edit.value.preliminary)
          )) ||
        (event.type === 'activity.changed' && event.activity.state === 'idle')
      )
        this.needsHistory = true
      this.schedule()
    })
    if (this.stopped || this.source !== source) {
      if (result.status === 'confirmed') await result.value.stop()
      return
    }
    if (result.status !== 'confirmed') {
      this.source = undefined
      throw new Error(result.error.message)
    }
    this.observation = result.value
    const contextVersion = this.contextVersion
    const usage = await this.handle.contextUsage()
    if (!this.stopped && this.source === source && contextVersion === this.contextVersion)
      application
        .get('CacheService')
        .setShared(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(this.context.sessionId), { result: usage })
    await this.flush()
  }

  private applyParts(event: LivePartInput): 'accepted' | 'persist' | undefined {
    const row = this.sourceRow(event.ref.id)
    if (!row) return undefined
    const accepted = this.projection.stageParts(event, row.partIds.length)
    if (!accepted) return undefined
    const decorated = this.decorateLive?.(event) ?? event
    const edits = partEdits(decorated)
    const added: string[] = []
    const patches: PublishedPartPatch<ChildPartPlacement>[] = []
    const results: { ref: DeferredToolResultRef; part: ToolOutput }[] = []
    let insertInto: string | undefined
    let persist = false
    for (const edit of edits) {
      const index = edit.part
      const existing = index < row.partIds.length ? row.partIds[index] : added[index - row.partIds.length]
      const partId = existing ?? uuid()
      let placement: { messageId: string; afterPartId?: string } | undefined
      if (!existing) {
        const previous = added.at(-1) ?? row.partIds.at(-1)
        const [messageId, afterPartId] = previous
          ? [insertInto ?? this.visibleParts.get(previous)?.messageId, previous]
          : this.insertionPoint(row.id)
        if (!messageId) {
          return 'persist'
        }
        placement = { messageId, afterPartId }
        insertInto = messageId
        added.push(partId)
      }
      switch (edit.type) {
        case 'open':
          if (!placement) {
            return 'persist'
          }
          patches.push({
            type: 'part-open',
            partId,
            ...placement,
            kind: edit.kind,
            ...(edit.providerMetadata && { providerMetadata: edit.providerMetadata })
          })
          break
        case 'append':
          patches.push({ type: 'part-append', partId, text: edit.text })
          break
        case 'finish':
          patches.push({
            type: 'part-finish',
            partId,
            ...(edit.providerMetadata && { providerMetadata: edit.providerMetadata })
          })
          persist = true
          break
        case 'correct':
          patches.push({
            type: 'part-correct',
            partId,
            part: {
              type: edit.kind,
              text: edit.text,
              state: edit.state,
              ...(edit.providerMetadata && { providerMetadata: edit.providerMetadata })
            }
          })
          persist ||= edit.state === 'done'
          break
        case 'put': {
          const part = edit.value as Exclude<CherryUIMessage['parts'][number], { type: 'text' | 'reasoning' }>
          const archiveMessageId = row.fragments[index + 1]?.messageId ?? row.id
          const { patch, ref } = projectAgentNonTextPart(buildAgentSessionTopicId(this.context.sessionId), {
            archiveMessageId,
            partId,
            part,
            ...(placement ? { type: 'part-add', placement } : { type: 'part-put' })
          })
          patches.push(patch)
          if (
            ref &&
            part.type === 'dynamic-tool' &&
            (part.state === 'output-available' || part.state === 'output-error')
          )
            results.push({ ref, part })
          persist ||=
            part.type !== 'dynamic-tool' ||
            part.state === 'output-denied' ||
            part.state === 'output-error' ||
            (part.state === 'output-available' && !part.preliminary)
          break
        }
      }
    }
    const values = new Map<string, { messageId: string; value: CherryUIMessage['parts'][number] }>()
    for (const [i, patch] of patches.entries()) {
      const previous = values.get(patch.partId) ?? this.visibleParts.get(patch.partId)
      const placement = patch.type === 'part-open' ? patch : patch.type === 'part-add' ? patch.placement : undefined
      const messageId = placement?.messageId ?? previous?.messageId
      if (!messageId) return 'persist'
      const sourcePart =
        decorated === event && patch.type !== 'part-put' && patch.type !== 'part-add'
          ? accepted.get(edits[i].part)?.value
          : undefined
      // Native and displayed text share the accepted value unless the harness filters or decorates that edit.
      const value =
        sourcePart?.type === 'text' || sourcePart?.type === 'reasoning'
          ? sourcePart
          : updatedPartValue(previous?.value, patch)
      if (!value) return 'persist'
      values.set(patch.partId, { messageId, value })
    }
    for (const [id, slot] of values) this.visibleParts.set(id, slot)
    for (const patch of patches) {
      if (this.changedParts.has(patch.partId)) continue
      const placement = patch.type === 'part-open' ? patch : patch.type === 'part-add' ? patch.placement : undefined
      this.changedParts.set(patch.partId, {
        messageId: values.get(patch.partId)!.messageId,
        ...(placement && { placement: { afterPartId: placement.afterPartId } })
      })
    }
    if (this.archiveEdits) {
      let edits = this.archiveEdits.get(row.id)
      if (!edits) this.archiveEdits.set(row.id, (edits = new Map()))
      for (const index of accepted.keys()) edits.set(index, event.ref.id)
    }
    row.partIds.push(...added)
    this.delivery.publishParts(patches)
    for (const { ref, part } of results) {
      this.pendingResults.set(ref.partId!, { messageId: ref.messageId, part })
      this.delivery.invalidateToolResults([ref])
    }
    return persist ? 'persist' : 'accepted'
  }

  async refresh(): Promise<void> {
    this.committedRefresh = true
    this.reloadSaved = true
    this.needsHistory = true
    await this.flush()
  }

  async drain(): Promise<void> {
    await this.attaching
    await this.observation?.drain()
    this.needsHistory = true
    await this.flush()
  }

  async refreshDecoration(ids: readonly string[] | true = true): Promise<void> {
    if (this.stopped) return
    await this.projection.accept([], ids)
    if (ids === true) this.committedRefresh = true
    else if (this.committedRefresh !== true) for (const id of ids) this.committedRefresh.add(id)
    this.needsHistory = true
    this.schedule()
  }

  private schedule(): void {
    this.timer ??= setTimeout(() => {
      this.timer = undefined
      void this.flush().catch((error) => {
        logger.error('Child archive flush failed', { contextId: this.context.id, error })
        this.publish({ ...this.view, diagnostic: String(error), available: false, canSubmit: false })
      })
    }, 80)
    this.timer.unref()
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const work = this.pending
      .then(() => this.reduce())
      .catch((error) => {
        this.needsHistory = true
        throw error
      })
    this.pending = work.catch(() => {})
    return work
  }

  private async reduce(): Promise<void> {
    if (this.reloadSaved) {
      for (const message of savedMessages(this.context.sessionId)) this.saved.set(message.id, message)
      this.reloadSaved = false
    }
    const history = this.needsHistory
    this.needsHistory = false
    if (history) this.archiveEdits = new Map()
    try {
      const archive = history ? await this.readCommitted() : undefined
      const writing = this.commit(archive && this.includeLaterParts(archive))
      this.publishingArchive = writing.catch(() => {})
      await writing
    } finally {
      this.archiveEdits = undefined
      this.publishingArchive = undefined
    }
  }

  private includeLaterParts(archive: CommittedHistory): CommittedHistory {
    const edits = this.archiveEdits
    if (!edits?.size) return archive
    return {
      ...archive,
      messages: archive.messages.map((message) => {
        const row = this.sourceRow(message.id) ?? this.sourceRow(archive.aliases[message.id])
        const changes = row && edits.get(row.id)
        if (!changes) return message
        const parts = message.parts.slice()
        for (const [index, nativeId] of changes) {
          const value = this.projection.part(nativeId, index)
          if (!value || index > parts.length) continue
          const previous = parts[index]
          if (previous && previous.type !== value.type) continue
          if (
            previous?.type === 'dynamic-tool' &&
            value.type === 'dynamic-tool' &&
            previous.toolCallId !== value.toolCallId
          )
            continue
          parts[index] = value
        }
        return { ...message, parts }
      })
    }
  }

  private async commit(archive?: CommittedHistory): Promise<void> {
    if (archive) {
      this.history = archive
      this.canonicalIds = new Map()
      for (const [id, live] of Object.entries(archive.aliases))
        if (!this.canonicalIds.has(live)) this.canonicalIds.set(live, id)
    }
    for (const id of archive?.removed ?? []) this.removed.add(id)
    for (const [old, source] of Object.entries(this.history?.legacy ?? {}))
      if (this.removed.has(source.messageId)) this.removed.add(old)
    for (const [id, live] of Object.entries(this.history?.aliases ?? {}))
      if (this.removed.has(id)) this.removed.add(live)
    for (const item of archive?.messages ?? [])
      if (
        item.metadata?.inputId &&
        this.nativeIds[item.id] !== item.metadata.inputId &&
        messages.inputBinding(this.context.sessionId, item.metadata.inputId)?.contextId === this.context.id
      )
        this.nativeIds[item.id] = item.metadata.inputId
    for (const [nativeId, liveId] of Object.entries(archive?.aliases ?? {})) {
      const id =
        this.nativeIds[nativeId] ??
        this.nativeIds[liveId] ??
        this.productIds.get(liveId) ??
        this.productIds.get(nativeId) ??
        uuid()
      this.nativeIds[nativeId] = id
      this.productIds.set(liveId, id)
      this.committedLiveIds.add(liveId)
    }
    let next = new Map(this.saved)
    const covered = new Set<string>()
    if (archive) {
      const recovered = (this.committed ??= new ThreadMessageProjection(
        this.handle.thread,
        (message, source, unchangedParts) => this.decorateMessage(message, source, unchangedParts)
      ))
      const refresh = this.committedRefresh
      this.committedRefresh = new Set()
      try {
        await recovered.accept(
          {
            type: 'snapshot',
            messages: archive.messages.filter((item) => !this.removed.has(item.id)),
            inputs: [],
            activity: this.projection.snapshot().activity
          },
          refresh === true ? true : [...refresh].flatMap((id) => [id, this.canonical(id)])
        )
      } catch (error) {
        // A failed projection is rebuilt from the next archive read.
        this.committed = undefined
        throw error
      }
      for (const message of recovered.snapshot().messages) {
        const id = (this.nativeIds[message.id] ??= this.productIds.get(message.id) ?? uuid())
        const rows = this.materialize(message, id)
        for (const row of rows) {
          covered.add(row.id)
          if (
            row.role === 'user' &&
            next.has(row.id) &&
            messages.inputBinding(this.context.sessionId, row.id)?.contextId === this.context.id
          )
            continue
          const saved = next.get(row.id)
          next.set(row.id, {
            ...row,
            parts: row.parts.length
              ? row.parts.map((part, index) =>
                  part.type === 'dynamic-tool'
                    ? part
                    : Object.assign({}, saved?.parts[index]?.type === part.type ? saved.parts[index] : undefined, part)
                )
              : (saved?.parts ?? [])
          })
        }
      }
    }
    await this.projection.drain()
    const current = this.projection.snapshot()
    for (const message of current.messages) {
      if (this.removed.has(message.id)) continue
      const id = this.nativeIds[message.id] ?? this.productIds.get(message.id) ?? uuid()
      this.productIds.set(message.id, id)
      if (
        (covered.has(id) && this.archiveEdits?.has(id)) ||
        ((covered.has(id) || this.committedLiveIds.has(message.id)) && next.get(id)?.metadata?.status !== 'pending') ||
        (message.role === 'user' &&
          next.has(id) &&
          messages.inputBinding(this.context.sessionId, id)?.contextId === this.context.id)
      )
        continue
      for (const row of this.materialize(message, id)) {
        covered.add(row.id)
        next.set(row.id, row)
      }
    }
    const mappings = new Map([...Object.entries(this.nativeIds), ...this.productIds])
    const retained = new Set([...mappings].filter(([source]) => !this.removed.has(source)).map(([, id]) => id))
    for (const source of this.removed) {
      const id = mappings.get(source)
      if (id && !retained.has(id)) next.delete(id)
    }
    const sourceOrder = new Set<string>()
    for (const message of [...(this.history?.messages ?? []), ...current.messages]) {
      if (this.removed.has(message.id)) continue
      for (const row of this.sourceRow(message.id)?.fragments ?? [])
        if (next.has(row.messageId)) sourceOrder.add(row.messageId)
    }
    const ordered = sourceOrder.values()
    // Uncovered archive rows may outlive native coverage; their absence is not a removal.
    const order = [...next.keys()].map((id) => (sourceOrder.has(id) ? ordered.next().value! : id))
    next = new Map(order.map((id) => [id, next.get(id)!]))
    this.composeSources(current.messages)
    const retainedSources = new Set(
      [...(this.history?.messages ?? []), ...current.messages]
        .filter((message) => !this.removed.has(message.id))
        .map((message) => mappings.get(message.id))
    )
    for (const id of this.materialized.keys()) if (!retainedSources.has(id)) this.materialized.delete(id)
    const changed = [...next.values()].filter((message) => !storedEqual(message, this.saved.get(message.id)))
    const reordered = !isDeepStrictEqual(order, [...this.saved.keys()])
    const durable = new Set(Object.values(this.nativeIds))
    const uncommitted = [...this.productIds.values()].some((id) => !durable.has(id))
    const checkpoint = {
      sources: this.nativeIds,
      gap: this.archiveGap ?? current.gap ?? (uncommitted ? 'mapping-reset' : undefined),
      removed: [...this.removed],
      composition: this.composition
    }
    const checkpointChanged = !isDeepStrictEqual(checkpoint, this.savedCheckpoint)
    if (changed.length || reordered || checkpointChanged) {
      const positions = new Map(order.map((id, index) => [id, index]))
      application.get('DbService').withWriteTx((tx) => {
        for (const message of changed) {
          const at = positions.get(message.id)!
          const before = this.saved.get(message.id)
          const unchangedToolCallIds = new Set(
            message.parts.flatMap((part, index) =>
              part === before?.parts[index] && part.type === 'dynamic-tool' && part.state === 'output-available'
                ? [part.toolCallId]
                : []
            )
          )
          messages.saveMessagesTx(tx, {
            sessionId: this.context.sessionId,
            parentId: at === 0 ? this.context.anchorMessageId! : order[at - 1],
            unchangedToolCallIds: new Map([[message.id, unchangedToolCallIds]]),
            partIdsByMessage: message.partIds && new Map([[message.id, message.partIds]]),
            messages: [
              {
                id: message.id,
                role: message.role,
                data: { parts: message.parts },
                status: message.metadata?.status ?? 'success'
              }
            ]
          })
        }
        if (reordered)
          messages.orderChildArchiveTx(
            tx,
            this.context.sessionId,
            order,
            [...this.saved.keys()].filter((id) => !next.has(id))
          )
        if (checkpointChanged)
          contexts.saveProjectionTx(
            tx,
            this.context.id,
            checkpoint.sources,
            checkpoint.gap,
            checkpoint.removed,
            checkpoint.composition
          )
      })
      if (checkpointChanged) this.savedCheckpoint = checkpointOf(checkpoint)
      this.saved.clear()
      for (const [id, message] of next) this.saved.set(id, message)
    }
    const topicId = buildAgentSessionTopicId(this.context.sessionId)
    const changedResults: DeferredToolResultRef[] = []
    for (const [partId, pending] of this.pendingResults) {
      if (!covered.has(pending.messageId) && next.has(pending.messageId)) continue
      this.pendingResults.delete(partId)
      changedResults.push({ topicId, messageId: pending.messageId, toolCallId: pending.part.toolCallId, partId })
    }
    for (const [responseId, nativeId] of Object.entries(archive?.responseIds ?? {})) {
      const messageId = this.nativeIds[nativeId]
      if (!messageId || this.reportedResponses.get(responseId) === messageId) continue
      this.reportedResponses.set(responseId, messageId)
      this.onResponse?.(responseId, messageId)
    }
    const renderedRows = new Map<string, ProjectedArchiveRow>()
    for (const [id, row] of next) {
      const before = this.renderedRows.get(id)
      renderedRows.set(id, projectArchiveRow(row, topicId, before, changedResults))
    }
    for (const [id, before] of this.renderedRows) {
      if (!renderedRows.has(id)) invalidateRemovedResults(before.source, undefined, topicId, changedResults)
    }
    this.renderedRows = renderedRows
    this.publish(
      {
        ...this.view,
        messages: compose(renderedRows, this.composition),
        active: current.activity.state === 'active',
        available: !this.stopped && !current.closed,
        canSubmit: !this.stopped && !current.closed && !!this.handle.input,
        diagnostic: current.diagnostic?.message ?? this.archiveGap ?? current.gap
      },
      changedResults
    )
  }

  private sourceRow(nativeId: string) {
    const id = this.nativeIds[nativeId] ?? this.productIds.get(nativeId)
    return id ? this.materialized.get(id) : undefined
  }

  private canonical(id: string): string {
    return this.canonicalIds.get(id) ?? id
  }

  private insertionPoint(rowId: string): [messageId: string, afterPartId?: string] {
    for (const [messageId, fragments] of Object.entries(this.composition)) {
      let afterPartId: string | undefined
      for (const fragment of fragments) {
        if (fragment.messageId === rowId) return [messageId, afterPartId]
        const index = fragment.parts.at(-1)
        if (index !== undefined)
          afterPartId = this.renderedRows.get(fragment.messageId)?.view.partIds?.[index] ?? afterPartId
      }
    }
    return [rowId]
  }

  private decorateMessage(
    message: CherryUIMessage,
    source: RuntimeMessage,
    unchangedParts?: ReadonlySet<number>
  ): CherryUIMessage {
    const error = source.metadata?.error
    if (error)
      message = {
        ...message,
        parts: [
          ...message.parts,
          {
            type: 'data-error',
            data: { name: 'AgentRuntimeError', message: error.message, stack: null, reason: error.code }
          }
        ]
      }
    return this.decorate?.(message, source, unchangedParts) ?? message
  }

  private materialize(message: CherryUIMessage, id: string): CherryUIMessage[] {
    const nativeId = this.canonical(message.id)
    const accepted = this.materialized.get(id)
    if (accepted?.source === message) return accepted.rows
    const assignments = new Map<number, string>()
    for (const [old, source] of Object.entries(this.history?.legacy ?? {})) {
      const row = this.nativeIds[old]
      if (source.messageId !== nativeId || !row) continue
      for (const part of source.parts) assignments.set(part, row)
    }
    const rows = new Map<string, CherryUIMessage & { partIds: string[] }>()
    const partIds: string[] = []
    const fragments: Composition[string] = [{ messageId: id, parts: [] }]
    message.parts.forEach((part, index) => {
      const rowId = assignments.get(index) ?? id
      const row = rows.get(rowId) ?? { ...message, id: rowId, parts: [], partIds: [] }
      const indexInRow = row.parts.length
      const partId = this.saved.get(rowId)?.partIds?.[indexInRow] ?? accepted?.partIds[index] ?? uuid()
      partIds.push(partId)
      row.partIds.push(partId)
      fragments.push({ messageId: rowId, parts: [row.parts.length] })
      row.parts.push(part)
      rows.set(rowId, row)
    })
    if (!rows.size) rows.set(id, { ...message, id, partIds: [] })
    const result = [...rows.values()]
    this.materialized.set(id, { source: message, id, rows: result, partIds, fragments })
    return result
  }

  private composeSources(current: readonly CherryUIMessage[]): void {
    const sources = new Map<string, { id: string; role: CherryUIMessage['role'] }>()
    for (const message of [...(this.history?.messages ?? []), ...current]) {
      const id = this.canonical(message.id)
      sources.set(id, { id, role: message.role })
    }
    const groups: Composition = {}
    let placed = false
    let reply: string | undefined
    const covered = new Set<string>()
    for (const source of sources.values()) {
      if (this.removed.has(source.id)) continue
      const fragments = this.sourceRow(source.id)?.fragments
      if (source.role === 'user') {
        placed = true
        reply = undefined
        continue
      }
      if (source.role !== 'assistant' || !fragments?.length) continue
      const owner = placed ? (reply ??= fragments[0].messageId) : fragments[0].messageId
      groups[owner] = [...(groups[owner] ?? []), ...fragments]
      for (const fragment of fragments) covered.add(fragment.messageId)
    }
    for (const [id, fragments] of Object.entries(this.composition))
      if (fragments.some((fragment) => covered.has(fragment.messageId))) delete this.composition[id]
    Object.assign(this.composition, groups)
  }

  retry(event: RetryPartData): void {
    if (this.stopped) return
    this.retryStatus = event.state === 'retrying' ? event : undefined
    this.publish(this.view)
  }

  private indexVisibleParts(rows: readonly CherryUIMessage[]): void {
    this.visibleParts.clear()
    for (const row of rows)
      row.partIds?.forEach((id, index) => {
        if (id) this.visibleParts.set(id, { messageId: row.id, value: row.parts[index] })
      })
  }

  private captureLiveRows(baseline: readonly CherryUIMessage[]): readonly CherryUIMessage[] {
    if (!this.changedParts.size) return baseline
    const byRow = new Map<string, Map<string, { afterPartId?: string } | undefined>>()
    for (const [id, { messageId, placement }] of this.changedParts) {
      let changes = byRow.get(messageId)
      if (!changes) byRow.set(messageId, (changes = new Map()))
      changes.set(id, placement)
    }
    this.changedParts.clear()
    return baseline.map((row) => {
      const changes = byRow.get(row.id)
      if (!changes) return row
      const ids = row.partIds?.slice() ?? []
      for (const [id, placement] of changes) {
        if (!placement) continue
        const after = placement.afterPartId
        if (after === ids.at(-1)) ids.push(id)
        else ids.splice(after ? ids.indexOf(after) + 1 : 0, 0, id)
      }
      return {
        ...row,
        partIds: ids,
        parts: ids.map((id, i) => (id && this.visibleParts.get(id)?.value) || row.parts[i])
      }
    })
  }

  private publish(next: AgentChildView, changedResults: readonly DeferredToolResultRef[] = []): void {
    this.view = next
    let { messages } = next
    if (this.retryStatus) {
      const last = messages.at(-1)
      const reply: CherryUIMessage =
        last?.role === 'assistant'
          ? last
          : { id: `retry:${this.context.id}`, role: 'assistant', parts: [], metadata: { status: 'pending' } }
      const updated: CherryUIMessage = {
        ...reply,
        parts: [...reply.parts, { type: 'data-retry', id: 'retry', data: this.retryStatus }]
      }
      messages = [...(last === reply ? messages.slice(0, -1) : messages), updated]
    }
    this.delivery.updateAccepted({ ...next, messages }, true, changedResults)
    this.indexVisibleParts(messages)
  }

  async stop(): Promise<void> {
    await this.attaching
    await this.observation?.drain()
    this.retryStatus = undefined
    this.stopped = true
    application.get('CacheService').deleteShared(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY(this.context.sessionId))
    this.source = undefined
    this.needsHistory = true
    await this.observation?.stop()
    await this.flush()
    await this.projection.close()
    this.publish({ ...this.view, available: false, canSubmit: false, active: false })
    this.delivery.flush()
    this.materialized.clear()
    this.pendingResults.clear()
    this.renderedRows.clear()
    this.unpublish()
    this.visibleParts.clear()
    this.changedParts.clear()
    this.delivery.dispose()
  }

  get thread(): Thread {
    return this.handle.thread
  }
}

/** A saved checkpoint copy; composition fragment lists are replaced, never mutated, so shallow copies suffice. */
function checkpointOf(child: Partial<NonNullable<AgentSessionCheckpoints['child']>>) {
  return {
    sources: { ...child.sources },
    gap: child.gap,
    removed: [...(child.removed ?? [])],
    composition: { ...child.composition }
  }
}
