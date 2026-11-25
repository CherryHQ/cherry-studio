import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useInfiniteFlatItems, useInfiniteQuery, useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { KnowledgeItemListResponse, KnowledgeItemSort } from '@shared/data/api/schemas/knowledges'
import {
  KNOWLEDGE_FILE_IMPORT_TRANSPORT_CHUNK,
  KNOWLEDGE_RUNTIME_ITEMS_MAX,
  type KnowledgeAddConflictStrategy,
  type KnowledgeAddItemInput,
  type KnowledgeAddItemsResult,
  type KnowledgeItem,
  type KnowledgeItemStatus
} from '@shared/data/types/knowledge'

export const KNOWLEDGE_ITEMS_PAGE_SIZE = 50

const KNOWLEDGE_ITEMS_POLLING_INTERVAL = 2000
const TERMINAL_STATUSES = new Set<KnowledgeItemStatus>(['completed', 'failed'])

const chunkKnowledgeItemIds = (itemIds: string[]) => {
  const batches: string[][] = []
  for (let index = 0; index < itemIds.length; index += KNOWLEDGE_RUNTIME_ITEMS_MAX) {
    batches.push(itemIds.slice(index, index + KNOWLEDGE_RUNTIME_ITEMS_MAX))
  }
  return batches
}

/**
 * Transport chunking for a single logical import operation: a 20+ file pick
 * stays one user operation, but IPC payloads stay bounded at
 * `KNOWLEDGE_FILE_IMPORT_TRANSPORT_CHUNK`. Processing concurrency stays bounded
 * downstream (per-base JobManager queue, 5 slots) without dropping accepted files.
 */
const chunkKnowledgeAddItems = (items: KnowledgeAddItemInput[]) => {
  const batches: KnowledgeAddItemInput[][] = []
  for (let index = 0; index < items.length; index += KNOWLEDGE_FILE_IMPORT_TRANSPORT_CHUNK) {
    batches.push(items.slice(index, index + KNOWLEDGE_FILE_IMPORT_TRANSPORT_CHUNK))
  }
  return batches
}

const hasNonTerminalItem = (pages?: KnowledgeItemListResponse[]) =>
  pages?.some((page) => page.items.some((item) => !TERMINAL_STATUSES.has(item.status))) ?? false

const normalizeKnowledgeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}

const addLogger = loggerService.withContext('useAddKnowledgeItems')
const deleteLogger = loggerService.withContext('useDeleteKnowledgeItem')
const reindexLogger = loggerService.withContext('useReindexKnowledgeItem')

type KnowledgeItemsLogger = typeof addLogger

const refreshKnowledgeItemsCaches = async (
  invalidateCache: ReturnType<typeof useInvalidateCache>,
  baseId: string,
  logger: KnowledgeItemsLogger,
  message: string,
  context: Record<string, unknown>
) => {
  try {
    await invalidateCache([`/knowledge-bases/${baseId}/items`, '/knowledge-bases'])
  } catch (invalidateError) {
    logger.error(message, normalizeKnowledgeError(invalidateError), context)
  }
}

export const useKnowledgeItems = (
  baseId: string,
  groupId: string | null = null,
  sort: KnowledgeItemSort | null = null
) => {
  // Without this, polling revalidates only page 0 (SWR's `revalidateFirstPage` default), and a
  // pure status flip never changes the keyset cursors, so later pages keep their key — a
  // non-terminal row on page ≥2 would stay stale forever AND keep `hasNonTerminalItem` true,
  // spinning the 2s interval with no end. While anything is processing, revalidate every loaded
  // page so later-page rows reach a terminal status and polling can stop; otherwise keep it off
  // so a scroll-to-bottom stays a single fetch. Driven off the previous render's pages because
  // the value feeds the config that produces those pages.
  const [revalidateAllPages, setRevalidateAllPages] = useState(false)

  // `null` lists the base's top-level items; a directory item's id lists that directory's
  // direct children (drill-down). Memoized so a stable object re-keys the query only on change.
  // `includeDeleting` keeps cancelling rows visible: without it the list hides
  // `deleting` on refresh and the Cancelling label could never render on real rows.
  const sortBy = sort?.sortBy
  const sortOrder = sort?.sortOrder
  const query = useMemo(
    () => ({ groupId, includeDeleting: true, ...(sortBy && sortOrder ? { sortBy, sortOrder } : {}) }),
    [groupId, sortBy, sortOrder]
  )

  const { pages, isLoading, error, hasNext, loadNext, refresh } = useInfiniteQuery('/knowledge-bases/:id/items', {
    params: { id: baseId },
    query,
    limit: KNOWLEDGE_ITEMS_PAGE_SIZE,
    enabled: Boolean(baseId),
    swrOptions: {
      refreshInterval: (pages?: KnowledgeItemListResponse[]) =>
        hasNonTerminalItem(pages) ? KNOWLEDGE_ITEMS_POLLING_INTERVAL : 0,
      keepPreviousData: false,
      revalidateAll: revalidateAllPages
    }
  })

  useEffect(() => {
    setRevalidateAllPages(hasNonTerminalItem(pages))
  }, [pages])

  const items = useInfiniteFlatItems(pages)
  // Server-side total across all pages, read off page 0 (every page carries the same `total`).
  // Consumers use it only to detect that unloaded rows remain (loaded < total); it stays fresh
  // as long as SWR revalidates page 0 — don't gate page 0's refresh behind future swrOptions.
  const total = pages[0]?.total ?? 0
  const hasMore = hasNext

  // `isLoadingMore` must track ONLY an in-flight load-more, never background polling: SWR's
  // `isRefreshing` spikes on every poll, so gating on it would silently drop a scroll-to-bottom
  // that lands during a poll. Flag a real load-more here and clear it once the requested page
  // lands (pages grew), pagination ends, or the fetch errors. Polling keeps `pages.length`
  // unchanged, so it never trips the reset and never blocks the next load-more.
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const loadStartPagesRef = useRef(0)

  const loadMore = useCallback(() => {
    if (isLoadingMore || !hasMore) {
      return
    }
    loadStartPagesRef.current = pages.length
    setIsLoadingMore(true)
    loadNext()
  }, [isLoadingMore, hasMore, pages.length, loadNext])

  useEffect(() => {
    if (isLoadingMore && (pages.length > loadStartPagesRef.current || !hasNext || error)) {
      setIsLoadingMore(false)
    }
  }, [isLoadingMore, pages.length, hasNext, error])

  // The hook instance is reused across knowledge-base switches and directory drill-downs (the
  // detail section doesn't remount), so an in-flight load-more from the previous base/directory
  // would otherwise leak into the next one and wedge `loadMore` — the clear effect above can't
  // fire when the next view loaded fewer pages than `loadStartPagesRef` and has more pages with
  // no error. Reset the in-flight bookkeeping whenever the base or directory changes so each
  // view starts clean.
  useEffect(() => {
    setIsLoadingMore(false)
    loadStartPagesRef.current = 0
  }, [baseId, groupId, sortBy, sortOrder])

  return {
    items,
    total,
    isLoading,
    error,
    hasMore,
    isLoadingMore,
    loadMore,
    refresh
  }
}

export const useAddKnowledgeItems = (baseId: string) => {
  const [error, setError] = useState<Error | undefined>()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const invalidateCache = useInvalidateCache()

  const submit = useCallback(
    async (
      items: KnowledgeAddItemInput[],
      conflictStrategy?: KnowledgeAddConflictStrategy
    ): Promise<KnowledgeAddItemsResult> => {
      if (!baseId) {
        return Promise.reject(new Error('Knowledge base id is required'))
      }

      if (items.length === 0) {
        return Promise.reject(new Error('At least one knowledge source must be selected'))
      }

      setError(undefined)
      setIsSubmitting(true)

      let submitError: Error | undefined
      let result: KnowledgeAddItemsResult | undefined
      try {
        // One logical import operation, bounded transport: `detect` and
        // `replace` need the whole batch in one call so same-name conflicts
        // are resolved atomically across all of it before anything is written
        // (atomic check-and-add for `detect`; atomic purge-then-add for
        // `replace`). Chunking `replace` would let an early chunk commit an
        // auto-renamed copy (e.g. `report.md` -> `report_1.md` when a
        // different-typed snapshot already occupies `report.md`) that a later
        // chunk then sees as an existing conflict and purges — silently
        // dropping a selected file. `rename` (the default, and every internal
        // caller) keeps all with auto-rename and never purges, so it stays
        // safe to chunk per `KNOWLEDGE_FILE_IMPORT_TRANSPORT_CHUNK` in order;
        // earlier chunks stay queued if a later chunk throws (partial
        // success), and per-file failed states surface via status polling.
        // Processing concurrency stays bounded downstream via the per-base
        // JobManager queue (5 slots) without dropping accepted files.
        if (conflictStrategy === 'rename' || conflictStrategy === undefined) {
          const batches = chunkKnowledgeAddItems(items)
          for (const batch of batches) {
            const batchResult = await ipcApi.request('knowledge.add_items', {
              baseId,
              items: batch,
              conflictStrategy
            })
            result = batchResult
          }
        } else {
          result = await ipcApi.request('knowledge.add_items', { baseId, items, conflictStrategy })
        }
      } catch (error) {
        submitError = normalizeKnowledgeError(error)

        addLogger.error('Failed to add knowledge sources', submitError, {
          baseId,
          sourceCount: items.length
        })

        setError(submitError)
      } finally {
        // A 'conflicts' result added nothing, so skip the cache refresh; refresh
        // on success (rows added) or on error (a partial add may have landed).
        if (submitError || result?.status === 'added') {
          await refreshKnowledgeItemsCaches(
            invalidateCache,
            baseId,
            addLogger,
            'Failed to refresh knowledge source list after submit',
            { baseId }
          )
        }

        setIsSubmitting(false)
      }

      if (submitError) {
        throw submitError
      }

      return result as KnowledgeAddItemsResult
    },
    [baseId, invalidateCache]
  )

  return {
    submit,
    isSubmitting,
    error
  }
}

export const useDeleteKnowledgeItem = (baseId: string) => {
  const [error, setError] = useState<Error | undefined>()
  const [isDeleting, setIsDeleting] = useState(false)
  const invalidateCache = useInvalidateCache()

  const deleteItems = useCallback(
    async (itemIds: string[]): Promise<void> => {
      if (!baseId) {
        return Promise.reject(new Error('Knowledge base id is required'))
      }

      setError(undefined)
      setIsDeleting(true)

      let deleteError: Error | undefined
      try {
        for (const batchItemIds of chunkKnowledgeItemIds(itemIds)) {
          await ipcApi.request('knowledge.delete_items', { baseId, itemIds: batchItemIds })
        }
      } catch (error) {
        deleteError = normalizeKnowledgeError(error)

        deleteLogger.error('Failed to delete knowledge source', deleteError, {
          baseId,
          itemIds
        })

        setError(deleteError)
      } finally {
        await refreshKnowledgeItemsCaches(
          invalidateCache,
          baseId,
          deleteLogger,
          'Failed to refresh knowledge source list after delete',
          {
            baseId,
            itemIds
          }
        )

        setIsDeleting(false)
      }

      if (deleteError) {
        throw deleteError
      }
    },
    [baseId, invalidateCache]
  )

  const deleteItem = useCallback((item: KnowledgeItem): Promise<void> => deleteItems([item.id]), [deleteItems])

  return {
    deleteItems,
    deleteItem,
    isDeleting,
    error
  }
}

export const useReindexKnowledgeItem = (baseId: string) => {
  const [error, setError] = useState<Error | undefined>()
  const [isReindexing, setIsReindexing] = useState(false)
  const invalidateCache = useInvalidateCache()

  const reindexItems = useCallback(
    async (itemIds: string[]): Promise<void> => {
      if (!baseId) {
        return Promise.reject(new Error('Knowledge base id is required'))
      }

      setError(undefined)
      setIsReindexing(true)

      let reindexError: Error | undefined
      try {
        for (const batchItemIds of chunkKnowledgeItemIds(itemIds)) {
          await ipcApi.request('knowledge.reindex_items', { baseId, itemIds: batchItemIds })
        }
      } catch (error) {
        reindexError = normalizeKnowledgeError(error)

        reindexLogger.error('Failed to reindex knowledge source', reindexError, {
          baseId,
          itemIds
        })

        setError(reindexError)
      } finally {
        await refreshKnowledgeItemsCaches(
          invalidateCache,
          baseId,
          reindexLogger,
          'Failed to refresh knowledge source list after reindex',
          {
            baseId,
            itemIds
          }
        )

        setIsReindexing(false)
      }

      if (reindexError) {
        throw reindexError
      }
    },
    [baseId, invalidateCache]
  )

  const reindexItem = useCallback((item: KnowledgeItem): Promise<void> => reindexItems([item.id]), [reindexItems])

  return {
    reindexItems,
    reindexItem,
    isReindexing,
    error
  }
}
