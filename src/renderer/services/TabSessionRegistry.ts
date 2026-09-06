/**
 * Tab sessions — state whose lifetime is a tab's rather than a component's.
 *
 * A page whose state must outlive the components rendering it, die with the tab hosting it, and
 * never leave this renderer can hang that state on a *tab session*. Translate is the first user;
 * nothing about the mechanism is translate's.
 *
 * **Identity** is a uuid in the tab's url (`?tabSession=`), minted by the route so the page never
 * renders without one:
 *
 * ```ts
 * beforeLoad: ({ search }) => {
 *   if (search.tabSession) return
 *   throw redirect({ to: '/app/translate', search: { tabSession: uuid() }, replace: true })
 * }
 * ```
 *
 * **Lifetime** is reachability from an open tab's url, and nothing else. That url survives every
 * unmount the tab system performs — `Activity` hide, LRU hibernation, route re-render, a restart,
 * a move to another window — so the session survives them too; a restart destroys the session's
 * runtime, not the session, and the runtime comes back empty. A session ends when its tab closes
 * or navigates away from the route that owns the id, both of which simply stop the id appearing
 * in any tab url.
 *
 * **State** goes in tab-scoped cache keys — `translate.input.${tabSession}` — so it can later
 * travel with a detached tab (#18925). Only non-serializable runtime belongs in the registry.
 *
 * **Runtime**, if the page has any, is whatever {@link TabSessionRegistry.getOrCreate} is asked to
 * build. The registry understands three methods ({@link TabSessionOwner}) and hands the rest of
 * the object back to the page untouched, so each page keeps its own vocabulary for its own work.
 */

import { loggerService } from '@logger'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

const logger = loggerService.withContext('TabSessionRegistry')

/**
 * Search param carrying a tab session's id. Deliberately not `sessionId`: the agent route already
 * uses that name for a conversation the database owns, while this one names state owned by the
 * tab itself.
 */
export const TAB_SESSION_PARAM = 'tabSession'

/**
 * What a page's session owns, in terms the registry understands. Everything else a page needs
 * belongs on the object this returns and never reaches the registry — `getOrCreate` hands that
 * object straight back to the caller, so a page defines its own vocabulary for its own runtime.
 */
export interface TabSessionOwner {
  /** True while the session owns unfinished work. */
  isBusy: () => boolean
  /** Cancel every unfinished unit of work. Called by the sweep, and by a user-initiated stop. */
  cancel: () => void
  /**
   * Drop the session's state. Returns false when it could not finish — the cache refuses to drop
   * a key a mounted hook still reads — so the session is kept and tried again on the next sweep.
   */
  release: () => boolean
}

/**
 * The part of a session the tab system itself uses.
 *
 * `isBusy` and `subscribe` are here because navigation reads them: the sidebar asks whether the
 * active tab has work in flight before replacing it, at a moment when that tab's page may not be
 * mounted at all. So busy-ness has to live in the session, not in the page's hook.
 */
export interface TabSessionHandle extends Pick<TabSessionOwner, 'isBusy' | 'cancel'> {
  readonly id: string
  /** Notified whenever `isBusy` may have changed, so a page can render the run's state. */
  subscribe: (listener: () => void) => () => void
}

interface SessionEntry {
  owner: TabSessionOwner
  handle: TabSessionHandle
  /** Set by `sweep`, consumed by `releaseUnreachable`. A tab session id is never reused. */
  unreachable: boolean
}

/**
 * Holds the live sessions and ends the ones no tab refers to any more.
 *
 * Because the lifetime rule is reachability, release is a sweep rather than a set of lifecycle
 * callbacks: no removal path — closing a tab, detaching it, navigating it elsewhere — has to
 * remember to notify, and a sweep that cannot finish simply runs again.
 */
class TabSessionRegistry {
  private sessions = new Map<string, SessionEntry>()

  /**
   * The session for `id`, creating it on first call.
   *
   * @param create - builds what this page's session owns. Called only on the first `getOrCreate`
   *   for an id; later calls return the existing session, so every caller for one id must expect
   *   the same shape. `notify` tells subscribers that `isBusy` may have changed. Whatever it
   *   returns beyond {@link TabSessionOwner} is returned to the caller untouched, so a page keeps
   *   its own vocabulary — translate hands back an `addStream`, and the registry never learns
   *   what a stream is.
   */
  getOrCreate<T extends TabSessionOwner>(id: string, create: (notify: () => void) => T): TabSessionHandle & T {
    const existing = this.sessions.get(id)
    if (existing) return existing.handle as TabSessionHandle & T

    const listeners = new Set<() => void>()
    const notify = () => {
      for (const listener of listeners) {
        listener()
      }
    }

    const owner = create(notify)
    const handle: TabSessionHandle & T = {
      ...owner,
      id,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
    this.sessions.set(id, { owner, handle, unreachable: false })
    return handle
  }

  get(id: string): TabSessionHandle | undefined {
    return this.sessions.get(id)?.handle
  }

  isBusy(id: string | undefined): boolean {
    return !!id && !!this.sessions.get(id)?.owner.isBusy()
  }

  /**
   * Mark every session no longer referenced by an open tab, cancelling its work. Idempotent.
   *
   * Cancelling is urgent — an unreachable session's work has no audience — but releasing is not,
   * and cannot happen here: the page whose tab just went away is still mounted at this point. See
   * `releaseUnreachable`.
   */
  sweep(liveIds: ReadonlySet<string>): void {
    for (const [id, entry] of this.sessions) {
      if (liveIds.has(id)) continue
      entry.unreachable = true
      entry.owner.cancel()
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
        released = entry.owner.release()
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
