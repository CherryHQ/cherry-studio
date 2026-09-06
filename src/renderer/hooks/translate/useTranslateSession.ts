import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { type TabSessionHandle, tabSessionRegistry } from '@renderer/services/TabSessionRegistry'
import type { UseCacheKey } from '@shared/data/cache/cacheSchemas'
import { useMemo } from 'react'

const logger = loggerService.withContext('useTranslateSession')

function sessionCacheKeys(tabSession: string): UseCacheKey[] {
  return [`translate.input.${tabSession}`, `translate.output.${tabSession}`]
}

export interface TranslateSessionHandle extends TabSessionHandle {
  /**
   * Adopt a main-owned translation by its task id. The returned callback marks it finished; a
   * task still adopted when the session is released is cancelled, which is the only place a
   * tab-scoped translation ends — unmounting the page that started it no longer kills it.
   *
   * An id rather than anything callable: the task runs in main and is cancelled through
   * `translate.task.cancel`, so a plain string is the whole handle. Detaching a tab destroys and
   * rebuilds this renderer, which nothing callable could survive.
   */
  addTask: (taskId: string) => () => void
  /** The task this session follows, if any — what a page re-attaches by after coming back. */
  currentTaskId: () => string | undefined
}

/**
 * The session that owns this translate page's draft and its in-flight run.
 *
 * The handle outlives the component: hibernating the tab or switching away from it unmounts the
 * page, and the run has to keep going (#18885). Only the tab dropping the id from its url ends
 * the session, at which point the registry cancels the run and this release drops the draft.
 *
 * Throws without an id rather than inventing one. The route mints it before the page renders, so
 * a missing id means that guarantee broke — and any id made up here would name a session no tab
 * refers to, which the next sweep would cancel and release under a page still using it.
 */
export function useTranslateSession(tabSession: string | undefined): TranslateSessionHandle {
  return useMemo(() => {
    if (!tabSession) {
      throw new Error("Translate page rendered without ?tabSession= — the route's beforeLoad must mint it")
    }

    return tabSessionRegistry.getOrCreate(tabSession, (notify) => {
      const tasks = new Set<string>()
      return {
        isBusy: () => tasks.size > 0,
        cancel: () => {
          if (tasks.size === 0) return
          for (const taskId of tasks) {
            void ipcApi.request('translate.task.cancel', { taskId }).catch((error: unknown) => {
              // Already settled or gone — main drives the final state through the task events.
              logger.debug('Task cancel request failed', { taskId, error })
            })
          }
          tasks.clear()
          notify()
        },
        release: () => {
          // Delete every key before reporting: a refusal on one (its hook is still mounted) must
          // not skip the rest, and the sweep retries the whole set anyway.
          let released = true
          for (const key of sessionCacheKeys(tabSession)) {
            if (!cacheService.delete(key)) released = false
          }
          return released
        },
        currentTaskId: () => tasks.values().next().value,
        addTask: (taskId: string) => {
          tasks.add(taskId)
          notify()
          return () => {
            if (tasks.delete(taskId)) notify()
          }
        }
      }
    })
  }, [tabSession])
}
