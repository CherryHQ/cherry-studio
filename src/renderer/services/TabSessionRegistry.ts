import { loggerService } from '@logger'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

const logger = loggerService.withContext('TabSessionRegistry')

/**
 * Search param carrying a tab session's id. Deliberately not `sessionId`: the agent route already
 * uses that name for a database entity, and these ids are renderer-memory-only — a restored tab
 * must drop its own while an agent tab keeps its.
 */
export const TAB_SESSION_PARAM = 'tabSession'

const TAB_URL_BASE = 'https://www.cherry-ai.com'

export interface TabSessionHandle {
  readonly id: string
  /**
   * Hand an in-flight task to the session. The returned callback marks it finished. A task still
   * registered when the session is released is aborted — that is the only place a tab-scoped task
   * gets cancelled, so unmounting the component that started it no longer kills it.
   */
  addTask: (controller: AbortController) => () => void
  /** True while the session owns at least one unfinished task. */
  isBusy: () => boolean
  /** Abort every unfinished task — an explicit user cancel, reachable after a remount. */
  abortTasks: () => void
  /** Notified whenever `isBusy` may have changed, so a page can render the run's state. */
  subscribe: (listener: () => void) => () => void
}

interface SessionEntry {
  tasks: Set<AbortController>
  release: () => boolean
  handle: TabSessionHandle
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
 * Only non-serializable runtime belongs here. Session *state* lives in tab-scoped cache keys so
 * it can later travel with a detached tab; see `docs` in issue #18925.
 */
class TabSessionRegistry {
  private sessions = new Map<string, SessionEntry>()

  /**
   * @param release - runs when the session becomes unreachable, after its tasks are aborted.
   *   Returns false when it could not finish — the cache refuses to drop a key a mounted hook
   *   still reads, and a page unmounts asynchronously after its tab navigates away — so the
   *   session is kept and retried on the next sweep. Only the first call for a given id
   *   registers one; later calls return the existing handle.
   */
  getOrCreate(id: string, release: () => boolean): TabSessionHandle {
    const existing = this.sessions.get(id)
    if (existing) return existing.handle

    const tasks = new Set<AbortController>()
    const listeners = new Set<() => void>()
    const notify = () => {
      for (const listener of listeners) {
        listener()
      }
    }
    const handle: TabSessionHandle = {
      id,
      addTask: (controller) => {
        tasks.add(controller)
        notify()
        return () => {
          if (tasks.delete(controller)) notify()
        }
      },
      isBusy: () => tasks.size > 0,
      abortTasks: () => {
        if (tasks.size === 0) return
        for (const controller of tasks) {
          controller.abort()
        }
        tasks.clear()
        notify()
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
    this.sessions.set(id, { tasks, release, handle })
    return handle
  }

  get(id: string): TabSessionHandle | undefined {
    return this.sessions.get(id)?.handle
  }

  isBusy(id: string | undefined): boolean {
    return !!id && !!this.sessions.get(id)?.tasks.size
  }

  /**
   * Release every session no longer referenced by an open tab. Idempotent.
   *
   * @returns how many releases were deferred and need another sweep.
   */
  sweep(liveIds: ReadonlySet<string>): number {
    let deferred = 0
    for (const [id, entry] of this.sessions) {
      if (liveIds.has(id)) continue

      // Abort first and unconditionally: an unreachable session's work has no audience, and
      // aborting twice is harmless if the release below has to be retried.
      entry.handle.abortTasks()

      let released = false
      try {
        released = entry.release()
      } catch (error) {
        logger.error('Session release failed', error as Error)
        released = true // a throwing release will not start working on a retry
      }
      if (!released) {
        deferred += 1
        continue
      }

      this.sessions.delete(id)
      logger.info('Tab session released', { sessionId: id })
    }
    return deferred
  }
}

export const tabSessionRegistry = new TabSessionRegistry()

/** The session a tab url refers to, if any. */
export function tabSessionIdFromUrl(url: string): string | undefined {
  try {
    return new URL(url, TAB_URL_BASE).searchParams.get(TAB_SESSION_PARAM) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * The same url with its session id removed. Used when a restored tab's session cannot exist any
 * more, and when comparing a tab against a plain route path.
 */
export function withoutTabSession(url: string): string {
  try {
    const parsed = new URL(url, TAB_URL_BASE)
    if (!parsed.searchParams.has(TAB_SESSION_PARAM)) return url
    parsed.searchParams.delete(TAB_SESSION_PARAM)
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return url
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
