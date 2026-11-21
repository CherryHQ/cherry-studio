import { loggerService } from '@logger'
import { dataApiService } from '@renderer/data/DataApiService'
import { ipcApi } from '@renderer/ipc'
import {
  applyMessageProjectionUpdate,
  type MessageProjectionUpdate,
  type MessageProjectionView,
  type ProjectionTarget
} from '@shared/ai/messageProjection'

import { toolResultService } from './ToolResultService'

const logger = loggerService.withContext('MessageProjectionService')
export interface ProjectionSnapshot {
  view: MessageProjectionView | null
  error?: string
}
const EMPTY: ProjectionSnapshot = Object.freeze({ view: null })

interface Entry {
  state: ProjectionSnapshot
  listeners: Set<() => void>
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

  getSnapshot(target: ProjectionTarget): ProjectionSnapshot {
    return this.entries.get(key(target))?.state ?? EMPTY
  }

  subscribe(target: ProjectionTarget, listener: () => void): () => void {
    const id = key(target)
    let entry = this.entries.get(id)
    if (!entry) {
      entry = { state: EMPTY, listeners: new Set(), stop: () => {} }
      this.entries.set(id, entry)
      this.connect(target, entry)
    }
    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
      if (entry.listeners.size === 0) {
        entry.stop()
        this.entries.delete(id)
      }
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

  private connect(target: ProjectionTarget, entry: Entry): void {
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
        if (
          owner &&
          effects.some(
            (effect) =>
              'routeParams' in effect &&
              ((owner.sessionId !== undefined && effect.routeParams?.sessionId === owner.sessionId) ||
                effect.routeParams?.topicId === owner.topicId)
          )
        )
          toolResultService.invalidateTopic(owner.topicId)
      }
    )
    let subscriptionId = ''
    let disposed = false
    let loading = false
    let pending: MessageProjectionUpdate[] = []
    let overflow = false
    const detach = (id: string) => {
      if (id)
        void ipcApi
          .request('ai.projection.detach', { target, subscriptionId: id })
          .catch((error) => logger.warn('Projection detach failed', { error }))
    }
    const apply = (update: MessageProjectionUpdate): boolean => {
      const current = entry.state.view
      const next = current && applyMessageProjectionUpdate(current, update)
      if (!next) {
        void attach()
        return false
      }
      if (next === current) return true
      bindDetailOwner(next)
      for (const patch of update.patches) if (patch.type === 'tool-result') toolResultService.invalidate(patch.ref)
      this.notify(entry, { view: next })
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
        bindDetailOwner(view)
        if (detailOwner) toolResultService.invalidateTopic(detailOwner.topicId)
        this.notify(entry, { view })
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
}

export const messageProjectionService = new MessageProjectionService()
