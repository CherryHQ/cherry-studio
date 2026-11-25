import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import {
  applyMessageProjectionUpdate,
  type MessageProjectionUpdate,
  type MessageProjectionView,
  type ProjectionTarget
} from '@shared/ai/messageProjection'

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
      this.notify(entry, { view: next })
      return true
    }
    const attach = async () => {
      if (disposed || loading) return
      detach(subscriptionId)
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
    }
    void attach()
  }
}

export const messageProjectionService = new MessageProjectionService()
