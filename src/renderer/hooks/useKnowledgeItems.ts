import { useInfiniteFlatItems, useInfiniteQuery, useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { KnowledgeItemListResponse } from '@shared/data/api/schemas/knowledges'
import type {
  KnowledgeAddConflictStrategy,
  KnowledgeAddItemInput,
  KnowledgeAddItemsResult,
  KnowledgeItem,
  KnowledgeItemStatus
} from '@shared/data/types/knowledge'
import { useCallback, useEffect, useRef, useState } from 'react'

const KNOWLEDGE_V2_ITEMS_QUERY = { groupId: null } as const
export const KNOWLEDGE_ITEMS_PAGE_SIZE = 50

const KNOWLEDGE_ITEMS_POLLING_INTERVAL = 2000
const TERMINAL_STATUSES = new Set<KnowledgeItemStatus>(['completed', 'failed'])

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

export const useKnowledgeItems = (baseId: string) => {
  // Without this, polling revalidates only page 0 (SWR's `revalidateFirstPage` default), and a
  // pure status flip never changes the keyset cursors, so later pages keep their key — a
  // non-terminal row on page ≥2 would stay stale forever AND keep `hasNonTerminalItem` true,
  // spinning the 2s interval with no end. While anything is processing, revalidate every loaded
  // page so later-page rows reach a terminal status and polling can stop; otherwise keep it off
  // so a scroll-to-bottom stays a single fetch. Driven off the previous render's pages because
  // the value feeds the config that produces those pages.
  const [revalidateAllPages, setRevalidateAllPages] = useState(false)

  const { pages, isLoading, error, hasNext, loadNext, refresh } = useInfiniteQuery('/knowledge-bases/:id/items', {
    params: { id: baseId },
    query: KNOWLEDGE_V2_ITEMS_QUERY,
    limit: KNOWLEDGE_ITEMS_PAGE_SIZE,
    enabled: Boolean(baseId),
    swrOptions: {
      refreshInterval: (pages?: KnowledgeItemListResponse[]) =>
        hasNonTerminalItem(pages) ? KNOWLEDGE_ITEMS_POLLING_INTERVAL : 0,
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

  // The hook instance is reused across knowledge-base switches (the detail section doesn't
  // remount), so an in-flight load-more from the previous base would otherwise leak into the
  // next one and wedge `loadMore` — the clear effect above can't fire when the new base loaded
  // fewer pages than `loadStartPagesRef` and has more pages with no error. Reset the in-flight
  // bookkeeping whenever the base changes so each base starts clean.
  useEffect(() => {
    setIsLoadingMore(false)
    loadStartPagesRef.current = 0
  }, [baseId])

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
        result = await ipcApi.request('knowledge.add_items', { baseId, items, conflictStrategy })
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

  const deleteItem = useCallback(
    async (item: KnowledgeItem): Promise<void> => {
      if (!baseId) {
        return Promise.reject(new Error('Knowledge base id is required'))
      }

      setError(undefined)
      setIsDeleting(true)

      let deleteError: Error | undefined
      try {
        await ipcApi.request('knowledge.delete_items', { baseId, itemIds: [item.id] })
      } catch (error) {
        deleteError = normalizeKnowledgeError(error)

        deleteLogger.error('Failed to delete knowledge source', deleteError, {
          baseId,
          itemId: item.id
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
            itemId: item.id
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

  return {
    deleteItem,
    isDeleting,
    error
  }
}

export const useReindexKnowledgeItem = (baseId: string) => {
  const [error, setError] = useState<Error | undefined>()
  const [isReindexing, setIsReindexing] = useState(false)
  const invalidateCache = useInvalidateCache()

  const reindexItem = useCallback(
    async (item: KnowledgeItem): Promise<void> => {
      if (!baseId) {
        return Promise.reject(new Error('Knowledge base id is required'))
      }

      setError(undefined)
      setIsReindexing(true)

      let reindexError: Error | undefined
      try {
        await ipcApi.request('knowledge.reindex_items', { baseId, itemIds: [item.id] })
      } catch (error) {
        reindexError = normalizeKnowledgeError(error)

        reindexLogger.error('Failed to reindex knowledge source', reindexError, {
          baseId,
          itemId: item.id
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
            itemId: item.id
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

  return {
    reindexItem,
    isReindexing,
    error
  }
}
