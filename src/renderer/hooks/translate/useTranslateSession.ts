import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { type TabSessionHandle, tabSessionRegistry } from '@renderer/services/TabSessionRegistry'
import type { UseCacheKey } from '@shared/data/cache/cacheSchemas'
import { useMemo } from 'react'

const logger = loggerService.withContext('useTranslateSession')

function sessionCacheKeys(tabSession: string): UseCacheKey[] {
  return [
    `translate.input.${tabSession}`,
    `translate.output.${tabSession}`,
    `translate.stream_text.${tabSession}`,
    `translate.detecting.${tabSession}`
  ]
}

export interface TranslateSessionHandle extends TabSessionHandle {
  /**
   * Hand a running main-process stream to the session, by id. The returned callback marks it
   * finished. A stream still registered when the session is released is aborted — that is the
   * only place a tab-scoped run gets cancelled, so unmounting the component that started it no
   * longer kills it.
   *
   * The id, not an `AbortController`: the run lives in main and is cancelled by
   * `ai.stream.abort`, so a plain string is the whole handle. Detaching a tab destroys and
   * rebuilds it in another window, which an `AbortController` could never survive.
   */
  addStream: (streamId: string) => () => void
  /**
   * How far the run has got, as accumulated text. The session holds it, not the page: with no
   * page mounted the run keeps advancing, and after a remount a different page instance has to
   * pick it up.
   */
  recordProgress: (accumulated: string) => void
  /** Discard it, for a page that replaced the output outside a run. */
  clearProgress: () => void
  /** Follow it. The listener fires at once with the current value, then on every change. */
  onProgress: (listener: (accumulated: string) => void) => () => void
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

    const progressKey = `translate.stream_text.${tabSession}` as const

    return tabSessionRegistry.getOrCreate(tabSession, (notify) => {
      const streams = new Set<string>()
      return {
        isBusy: () => streams.size > 0,
        cancel: () => {
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
        release: () => {
          // Delete every key before reporting: a refusal on one (its hook is still mounted) must
          // not skip the rest, and the sweep retries the whole set anyway.
          let released = true
          for (const key of sessionCacheKeys(tabSession)) {
            if (!cacheService.delete(key)) released = false
          }
          return released
        },
        recordProgress: (accumulated: string) => {
          cacheService.set(progressKey, accumulated)
        },
        clearProgress: () => {
          cacheService.set(progressKey, '')
        },
        onProgress: (listener: (accumulated: string) => void) => {
          const emit = () => listener(cacheService.get(progressKey) ?? '')
          emit()
          return cacheService.subscribe(progressKey, emit)
        },
        addStream: (streamId: string) => {
          streams.add(streamId)
          notify()
          return () => {
            if (streams.delete(streamId)) notify()
          }
        }
      }
    })
  }, [tabSession])
}
