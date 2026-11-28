import { loggerService } from '@logger'
import { dataApiService } from '@renderer/data/DataApiService'
import { ipcApi } from '@renderer/ipc'
import type { ProjectionPartReader, ProjectionLayoutReader, MessageTextChange } from '@renderer/types/message'
import {
  applyMessageProjectionUpdate,
  type ProjectionNotification,
  type LivePartPatch,
  type MessageProjectionView,
  type ProjectionTarget
} from '@shared/ai/messageProjection'
import type { CherryMessagePart } from '@shared/data/types/message'

import { applyLiveParts } from './applyLiveParts'
import { ProjectionRowLayout, type RowPart } from './ProjectionRowLayout'
import { toolResultService } from './ToolResultService'

const logger = loggerService.withContext('MessageProjectionService')
export interface ProjectionSnapshot {
  view: MessageProjectionView | null
  error?: string
}
const EMPTY: ProjectionSnapshot = Object.freeze({ view: null })

interface LiveRow {
  id: string
  at: number
  turnOrigin: MessageTextChange['turnOrigin']
  addressed: boolean
  layout?: ProjectionRowLayout
}

interface LivePart extends RowPart {
  pos?: number | null
  awaitingText: boolean
  row: LiveRow
}

type LayoutObserver = (
  changed: ReadonlyMap<string, { before?: CherryMessagePart; after: CherryMessagePart; row: string }>
) => void

interface Entry {
  state: ProjectionSnapshot
  revision: number
  parts: Map<string, LivePart>
  rows: Map<string, LiveRow>
  subscriptions: Map<string, Set<() => void>>
  layoutObservers: Set<LayoutObserver>
  pendingRows: Set<string>
  listeners: Set<() => void>
  textListeners: Set<(change: MessageTextChange) => void>
  stop: () => void
}

function key(target: ProjectionTarget): string {
  return target.kind === 'topic'
    ? JSON.stringify(['topic', target.topicId])
    : JSON.stringify(['child', target.sessionId, target.toolCallId])
}

/** One subscription per window and view, shared by cards, panels and message lists. */
export class MessageProjectionService {
  private readonly entries = new Map<string, Entry>()
  private readonly partReferences = new WeakMap<CherryMessagePart, { target: ProjectionTarget; id: string }>()

  private readonly rowReferences = new WeakMap<readonly CherryMessagePart[], { target: ProjectionTarget; id: string }>()

  getSnapshot(target: ProjectionTarget): ProjectionSnapshot {
    return this.entries.get(key(target))?.state ?? EMPTY
  }

  ownsRowParts(parts: readonly CherryMessagePart[]): boolean {
    const ref = this.rowReferences.get(parts)
    return !!ref && !!this.entries.get(key(ref.target))?.rows.get(ref.id)?.layout
  }

  getPart(part: CherryMessagePart | undefined): CherryMessagePart | undefined {
    const ref = part && this.partReferences.get(part)
    return (ref && this.readPart(ref.target, ref.id)) ?? part
  }

  getPartId(part: CherryMessagePart): string | undefined {
    return this.partReferences.get(part)?.id
  }

  partsFor(target: ProjectionTarget): ProjectionPartReader & ProjectionLayoutReader {
    return {
      read: (id) => this.readPart(target, id),
      subscribe: (id, listener) => this.watchPart(target, id, listener),
      row: (id) => this.entries.get(key(target))?.rows.get(id)?.layout
    }
  }

  readPart(target: ProjectionTarget, partId: string): CherryMessagePart | undefined {
    return this.entries.get(key(target))?.parts.get(partId)?.value
  }

  watchPart(target: ProjectionTarget, partId: string, listener: () => void): () => void {
    const entry = this.entry(target)
    let listeners = entry.subscriptions.get(partId)
    if (!listeners) entry.subscriptions.set(partId, (listeners = new Set()))
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) entry.subscriptions.delete(partId)
      this.release(target, entry)
    }
  }

  /** Read current content for a copy or export action without subscribing the list. */
  readParts(parts: readonly CherryMessagePart[]): CherryMessagePart[] {
    const ref = this.rowReferences.get(parts)
    const row = ref && this.entries.get(key(ref.target))?.rows.get(ref.id)
    if (!row?.layout) return parts.map((part) => this.getPart(part) ?? part)
    const values: CherryMessagePart[] = []
    row.layout.forEachPart((slot) => values.push(slot.value))
    return values
  }

  readMessage(target: ProjectionTarget, baseline: MessageProjectionView['messages'][number]) {
    const row = this.entries.get(key(target))?.rows.get(baseline.id)
    if (!row?.layout) return baseline
    const parts: CherryMessagePart[] = []
    const partIds: string[] = []
    const partPositions: (number | null)[] = []
    row.layout.forEachPart((part) => {
      partIds.push(part.id)
      partPositions.push(this.entries.get(key(target))?.parts.get(part.id)?.pos ?? null)
      parts.push(part.value)
    })
    return { ...baseline, partIds, partPositions, parts }
  }

  private entry(target: ProjectionTarget): Entry {
    const id = key(target)
    let entry = this.entries.get(id)
    if (!entry) {
      entry = {
        state: EMPTY,
        revision: 0,
        parts: new Map(),
        rows: new Map(),
        subscriptions: new Map(),
        layoutObservers: new Set(),
        pendingRows: new Set(),
        listeners: new Set(),
        textListeners: new Set(),
        stop: () => {}
      }
      this.entries.set(id, entry)
      this.connect(target, entry)
    }
    return entry
  }

  private release(target: ProjectionTarget, entry: Entry): void {
    if (entry.listeners.size || entry.subscriptions.size) return
    entry.stop()
    this.entries.delete(key(target))
  }

  subscribe(target: ProjectionTarget, listener: () => void, onText?: (change: MessageTextChange) => void): () => void {
    const entry = this.entry(target)
    entry.listeners.add(listener)
    if (onText) entry.textListeners.add(onText)
    return () => {
      entry.listeners.delete(listener)
      if (onText) entry.textListeners.delete(onText)
      this.release(target, entry)
    }
  }

  observeLayout(target: ProjectionTarget, observer: LayoutObserver, onBaseline: () => void): () => void {
    const off = this.subscribe(target, onBaseline)
    const entry = this.entry(target)
    entry.layoutObservers.add(observer)
    return () => {
      entry.layoutObservers.delete(observer)
      off()
    }
  }

  private notify(entry: Entry, state: ProjectionSnapshot): void {
    if (entry.state.view === state.view && entry.state.error === state.error) return
    entry.state = state
    for (const listener of entry.listeners) {
      try {
        listener()
      } catch (error) {
        logger.warn('Projection view listener failed', { error })
      }
    }
  }

  private commitParts(
    target: ProjectionTarget,
    entry: Omit<Entry, 'state' | 'listeners' | 'stop'>,
    revision: number,
    patches: readonly LivePartPatch[]
  ): boolean {
    const edits = applyLiveParts(
      patches,
      (id) => {
        const slot = entry.parts.get(id)
        return (
          slot && {
            messageId: slot.row.id,
            turnOrigin: slot.row.turnOrigin,
            value: slot.value,
            awaitingText: slot.awaitingText
          }
        )
      },
      (id) => {
        const row = entry.rows.get(id)
        return row?.addressed ? { turnOrigin: row.turnOrigin } : undefined
      }
    )
    if (!edits) return false
    entry.revision = revision
    const textAnchors = new Map<string, string | undefined>()
    for (const [id, { messageId, value, placement }] of edits.inserted) {
      const slot: LivePart = {
        id,
        pos: placement.pos,
        row: entry.rows.get(messageId)!,
        value,
        layout: { partId: id },
        text: value.type === 'text',
        awaitingText: (value.type === 'text' || value.type === 'reasoning') && !value.text.trim()
      }
      if (placement.pos !== undefined) slot.row.layout!.append(slot)
      else slot.row.layout!.place(slot, placement.afterPartId ? entry.parts.get(placement.afterPartId) : undefined)
      entry.parts.set(id, slot)
      if (slot.text && entry.textListeners.size) textAnchors.set(id, slot.row.layout!.previousText(slot))
    }
    const layouts = new Set<ProjectionRowLayout>()
    const selected = new Map<string, { before?: CherryMessagePart; after: CherryMessagePart; row: string }>()
    for (const [id, value] of edits.changes) {
      const slot = entry.parts.get(id)!
      if (entry.layoutObservers.size && edits.layout.has(id))
        selected.set(id, { before: edits.inserted.has(id) ? undefined : slot.value, after: value, row: slot.row.id })
      slot.value = value
      entry.pendingRows.add(slot.row.id)
      this.partReferences.set(value, { target, id: slot.id })
      const layout = edits.layout.has(id) && slot.row.layout
      if (layout) {
        slot.awaitingText = (value.type === 'text' || value.type === 'reasoning') && !value.text.trim()
        if (!edits.inserted.has(id)) layout.change(slot)
        layouts.add(layout)
      }
    }
    for (const layout of layouts) layout.notify()
    if (selected.size) for (const observer of entry.layoutObservers) observer(selected)
    for (const id of edits.changes.keys()) for (const listener of entry.subscriptions.get(id) ?? []) listener()
    for (const change of edits.text) {
      if (change.type === 'text-open') change.afterTextPartId = textAnchors.get(change.partId)
      for (const listener of entry.textListeners) listener(change)
    }
    return true
  }

  private connect(target: ProjectionTarget, entry: Entry): void {
    const indexParts = (view: MessageProjectionView | null) => {
      const previousRows = new Map(entry.rows)
      const refreshed: ProjectionRowLayout[] = []
      const before = new Map([...entry.subscriptions.keys()].map((id) => [id, entry.parts.get(id)?.value]))
      entry.parts.clear()
      entry.rows.clear()
      entry.pendingRows.clear()
      view?.messages.forEach((item, at) => {
        const row: LiveRow = {
          id: item.id,
          at,
          turnOrigin: item.metadata?.turnOrigin,
          addressed: (item.partIds?.length ?? 0) === item.parts.length
        }
        entry.rows.set(item.id, row)
        this.rowReferences.set(item.parts, { target, id: item.id })
        const slots: LivePart[] = []
        item.partIds?.forEach((id, index) => {
          const value = item.parts[index]
          if (!id || !value) {
            row.addressed = false
            return
          }
          const slot: LivePart = {
            id,
            pos: item.partPositions?.[index],
            value,
            row,
            layout: { partId: id },
            text: value.type === 'text',
            awaitingText: (value.type === 'text' || value.type === 'reasoning') && !value.text.trim()
          }
          slots.push(slot)
          entry.parts.set(id, slot)
          this.partReferences.set(value, { target, id })
        })
        const previous = previousRows.get(item.id)?.layout
        if (row.addressed) {
          row.layout = previous ?? new ProjectionRowLayout(slots)
          if (previous) {
            previous.reset(slots)
            refreshed.push(previous)
          }
          previousRows.delete(item.id)
        }
      })
      for (const row of previousRows.values())
        if (row.layout) {
          row.layout.reset([])
          refreshed.push(row.layout)
        }
      return () => {
        for (const row of refreshed) row.notify()
        for (const [id, value] of before)
          if (value !== entry.parts.get(id)?.value) for (const listener of entry.subscriptions.get(id) ?? []) listener()
      }
    }
    let detailOwner: { topicId: string; sessionId?: string; release: () => void } | undefined
    const bindDetailOwner = (view: MessageProjectionView | null) => {
      const topicId =
        target.kind === 'topic'
          ? target.topicId
          : view?.kind === 'child'
            ? `agent-session:${view.sessionId}`
            : undefined
      if (detailOwner?.topicId === topicId) return
      detailOwner?.release()
      detailOwner = topicId
        ? {
            topicId,
            sessionId: topicId.startsWith('agent-session:') ? topicId.slice('agent-session:'.length) : undefined,
            release: toolResultService.retainTopic(topicId)
          }
        : undefined
    }
    bindDetailOwner(null)
    const stopDataChanges = dataApiService.onDataChanged(
      ['/agent-sessions/:sessionId/messages', '/topics/:topicId/messages'],
      (effects) => {
        const owner = detailOwner
        if (!owner) return
        const endpoint = owner.sessionId ? '/agent-sessions/:sessionId/messages' : '/topics/:topicId/messages'
        const ids = new Set<string>()
        for (const effect of effects) {
          if (effect.endpoint !== endpoint) continue
          const scopedId = owner.sessionId ? effect.routeParams?.sessionId : effect.routeParams?.topicId
          if (scopedId !== undefined && scopedId !== (owner.sessionId ?? owner.topicId)) continue
          if (effect.kind !== 'projection' || !effect.entityIds) {
            toolResultService.invalidateTopic(owner.topicId)
            return
          }
          for (const id of effect.entityIds) ids.add(id)
        }
        for (const id of ids) toolResultService.invalidateMessage(owner.topicId, id)
      }
    )
    let subscriptionId = ''
    let disposed = false
    let loading = false
    let pending: ProjectionNotification[] = []
    let overflow = false
    const detach = (id: string) => {
      if (id)
        void ipcApi
          .request('ai.projection.detach', { target, subscriptionId: id })
          .catch((error) => logger.warn('Projection detach failed', { error }))
    }
    const apply = (update: ProjectionNotification): boolean => {
      if (update.kind === 'source-changed') {
        void attach()
        return false
      }
      const current = entry.state.view
      if (current && update.revision <= entry.revision) return true
      const first = update.patches[0]
      if (
        current?.kind === update.kind &&
        update.revision === entry.revision + 1 &&
        !update.order &&
        first?.type === 'tool-result' &&
        update.patches.every((patch) => patch.type === 'tool-result')
      ) {
        entry.revision = update.revision
        for (const patch of update.patches) if (patch.type === 'tool-result') toolResultService.invalidate(patch.ref)
        return true
      }
      if (update.type === 'parts') {
        if (
          current?.kind === update.kind &&
          update.revision === entry.revision + 1 &&
          !update.order &&
          this.commitParts(target, entry, update.revision, update.patches)
        )
          return true
        void attach()
        return false
      }
      const next = current && applyMessageProjectionUpdate(this.materialize(current, entry), update)
      if (!next) {
        void attach()
        return false
      }
      entry.revision = next.revision
      const notifyParts = current?.messages !== next.messages ? indexParts(next) : undefined
      bindDetailOwner(next)
      for (const patch of update.patches) if (patch.type === 'tool-result') toolResultService.invalidate(patch.ref)
      this.notify(entry, { view: next })
      notifyParts?.()
      return true
    }
    const attach = async () => {
      if (disposed || loading) return
      detach(subscriptionId)
      if (detailOwner) toolResultService.invalidateTopic(detailOwner.topicId)
      const generation = crypto.randomUUID()
      subscriptionId = generation
      pending = []
      overflow = false
      loading = true
      try {
        const view = await ipcApi.request('ai.projection.attach', { target, subscriptionId: generation })
        if (disposed || subscriptionId !== generation) return
        loading = false
        if (view && view.kind !== target.kind) throw new Error('Projection owner mismatch')
        entry.revision = view?.revision ?? 0
        const notifyParts = indexParts(view)
        bindDetailOwner(view)
        if (detailOwner) toolResultService.invalidateTopic(detailOwner.topicId)
        this.notify(entry, { view })
        notifyParts()
        if (overflow) {
          void attach()
          return
        }
        const buffered = pending
        pending = []
        for (const update of buffered) if (!apply(update)) break
      } catch (error) {
        if (disposed || subscriptionId !== generation) return
        loading = false
        this.notify(entry, { view: entry.state.view, error: String(error) })
        logger.warn('Projection attach failed', { error })
      }
    }
    const off = ipcApi.on('ai.projection.changed', (event) => {
      if (disposed || event.subscriptionId !== subscriptionId) return
      if (loading) {
        if (overflow) return
        pending.push(event.update)
        if (pending.length > 100) {
          pending = []
          overflow = true
        }
      } else apply(event.update)
    })
    entry.stop = () => {
      disposed = true
      off()
      detach(subscriptionId)
      pending = []
      stopDataChanges()
      detailOwner?.release()
      detailOwner = undefined
    }
    void attach()
  }

  private materialize(view: MessageProjectionView, entry: Entry): MessageProjectionView {
    const rows = entry.pendingRows
    if (!rows.size) return view.revision === entry.revision ? view : { ...view, revision: entry.revision }
    const messages = view.messages.slice()
    for (const id of rows) {
      const row = entry.rows.get(id)!
      const baseline = messages[row.at]
      if (!row.addressed) {
        const parts = baseline.parts.map((value, index) => {
          const id = baseline.partIds?.[index]
          return (id && entry.parts.get(id)?.value) || value
        })
        messages[row.at] = { ...baseline, parts }
        continue
      }
      const parts: CherryMessagePart[] = []
      const partIds: string[] = []
      row.layout!.forEachPart((slot) => {
        parts.push(slot.value)
        partIds.push(slot.id)
      })
      messages[row.at] = { ...messages[row.at], parts, partIds }
    }
    return { ...view, messages, revision: entry.revision }
  }
}

export const messageProjectionService = new MessageProjectionService()
