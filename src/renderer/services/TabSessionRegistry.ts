import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

const logger = loggerService.withContext('TabSessionRegistry')

/**
 * Search param carrying a tab session's id. Deliberately not `sessionId`: the agent route already
 * uses that name for a conversation the database owns, while this one names state owned by the
 * tab itself.
 */
export const TAB_SESSION_PARAM = 'tabSession'

export interface TabSessionHandle {
  readonly id: string
  /**
   * Hand a running main-process stream to the session, by id. The returned callback marks it
   * finished. A stream still registered when the session is released is aborted — that is the only
   * place a tab-scoped run gets cancelled, so unmounting the component that started it no longer
   * kills it.
   *
   * The id, not an `AbortController`: the run lives in main and is cancelled by
   * `ai.stream.abort`, so a plain string is the whole handle. Detaching a tab destroys and
   * rebuilds it in another window, which an `AbortController` could never survive.
   */
  addStream: (streamId: string) => () => void
  /** True while the session owns at least one unfinished stream. */
  isBusy: () => boolean
  /** Abort every unfinished stream — an explicit user cancel, reachable after a remount. */
  abortStreams: () => void
  /** Notified whenever `isBusy` may have changed, so a page can render the run's state. */
  subscribe: (listener: () => void) => () => void
}

interface SessionEntry {
  streams: Set<string>
  release: () => boolean
  handle: TabSessionHandle
  /** Set by `sweep`, consumed by `releaseUnreachable`. A tab session id is never reused. */
  unreachable: boolean
}

/**
 * Owns the runtime of tab-scoped sessions: the things that must outlive the components rendering
 * them, yet die with the tab that hosts them.
 *
 * A session's identity lives in its tab's URL (`?tabSession=`), which survives every kind of
 * unmount the tab system performs — `Activity` hide, LRU hibernation, route re-render — and
 * travels with the tab across windows. Reachability from that URL is therefore the whole
 * lifetime rule, so release is a sweep rather than a set of lifecycle callbacks: no removal path
 * needs to remember to notify, and a sweep that cannot finish simply runs again.
 *
 * A restart is one more of those unmounts. The tab is persisted and restored with its url, so the
 * id stays reachable and the session continues; what a restart destroys is the session's runtime,
 * which comes back empty. A session ends when its tab closes or navigates away from the route
 * that owns the id — nothing else.
 *
 * Only non-serializable runtime belongs here. Session *state* lives in tab-scoped cache keys so
 * it can later travel with a detached tab; see `docs` in issue #18925.
 */
class TabSessionRegistry {
  private sessions = new Map<string, SessionEntry>()

  /**
   * @param release - runs on `releaseUnreachable`, after the session's streams are aborted.
   *   Returns false when it could not finish — the cache refuses to drop a key a mounted hook
   *   still reads — so the session is kept and tried again on the next sweep. Only the first call
   *   for a given id registers one; later calls return the existing handle.
   */
  getOrCreate(id: string, release: () => boolean): TabSessionHandle {
    const existing = this.sessions.get(id)
    if (existing) return existing.handle

    const streams = new Set<string>()
    const listeners = new Set<() => void>()
    const notify = () => {
      for (const listener of listeners) {
        listener()
      }
    }
    const handle: TabSessionHandle = {
      id,
      addStream: (streamId) => {
        streams.add(streamId)
        notify()
        return () => {
          if (streams.delete(streamId)) notify()
        }
      },
      isBusy: () => streams.size > 0,
      abortStreams: () => {
        if (streams.size === 0) return
        for (const streamId of streams) {
          void ipcApi.request('ai.stream.abort', { topicId: streamId }).catch((error: unknown) => {
            // Already finished or gone — main drives the final reject via the stream error event.
            logger.debug('Stream abort request failed', { streamId, error })
          })
        }
        streams.clear()
        notify()
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
    this.sessions.set(id, { streams, release, handle, unreachable: false })
    return handle
  }

  get(id: string): TabSessionHandle | undefined {
    return this.sessions.get(id)?.handle
  }

  isBusy(id: string | undefined): boolean {
    return !!id && !!this.sessions.get(id)?.streams.size
  }

  /**
   * Mark every session no longer referenced by an open tab, aborting its streams. Idempotent.
   *
   * Aborting is urgent — an unreachable session's work has no audience — but releasing is not, and
   * cannot happen here: the page whose tab just went away is still mounted at this point. See
   * `releaseUnreachable`.
   */
  sweep(liveIds: ReadonlySet<string>): void {
    for (const [id, entry] of this.sessions) {
      if (liveIds.has(id)) continue
      entry.unreachable = true
      entry.handle.abortStreams()
    }
  }

  /**
   * Run the release of every session `sweep` marked unreachable. Idempotent.
   *
   * Kept apart from `sweep` and called on a delay: a tab's url stops referencing its session
   * before the page rendering it unmounts, and the cache refuses to drop a key a mounted
   * `useCache` still reads (#20074). A refused session keeps its mark and is tried again after
   * the next sweep.
   */
  releaseUnreachable(): void {
    for (const [id, entry] of this.sessions) {
      if (!entry.unreachable) continue

      let released = false
      try {
        released = entry.release()
      } catch (error) {
        logger.error('Session release failed', error as Error)
        released = true // a throwing release will not start working on a retry
      }
      if (!released) continue

      this.sessions.delete(id)
      logger.info('Tab session released', { sessionId: id })
    }
  }
}

export const tabSessionRegistry = new TabSessionRegistry()

/** The session a tab url refers to, if any. */
export function tabSessionIdFromUrl(url: string): string | undefined {
  try {
    return new URL(url, 'https://www.cherry-ai.com').searchParams.get(TAB_SESSION_PARAM) ?? undefined
  } catch {
    return undefined
  }
}

/** Session ids still referenced by an open tab. */
export function collectLiveSessionIds(tabs: readonly Tab[]): Set<string> {
  const ids = new Set<string>()
  for (const tab of tabs) {
    if (tab.type !== 'route') continue
    const id = tabSessionIdFromUrl(tab.url)
    if (id) ids.add(id)
  }
  return ids
}
