import { useInvalidateCache, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { KNOWLEDGE_ITEMS_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeAddItemInput, KnowledgeItem, KnowledgeItemStatus } from '@shared/data/types/knowledge'
import { useCallback, useState } from 'react'

const KNOWLEDGE_V2_ITEMS_QUERY = {
  page: 1,
  limit: KNOWLEDGE_ITEMS_MAX_LIMIT,
  groupId: null
} as const

const EMPTY_KNOWLEDGE_ITEMS: KnowledgeItem[] = []
const KNOWLEDGE_ITEMS_POLLING_INTERVAL = 2000
const TERMINAL_STATUSES = new Set<KnowledgeItemStatus>(['completed', 'failed'])

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
  const { data, isLoading, error, refetch } = useQuery('/knowledge-bases/:id/items', {
    params: { id: baseId },
    query: KNOWLEDGE_V2_ITEMS_QUERY,
    enabled: Boolean(baseId),
    swrOptions: {
      refreshInterval: (data) =>
        data?.items.some((item) => !TERMINAL_STATUSES.has(item.status)) ? KNOWLEDGE_ITEMS_POLLING_INTERVAL : 0
    }
  })

  return {
    items: data?.items ?? EMPTY_KNOWLEDGE_ITEMS,
    total: data?.total ?? 0,
    isLoading,
    error,
    refetch
  }
}

export const useAddKnowledgeItems = (baseId: string) => {
  const [error, setError] = useState<Error | undefined>()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const invalidateCache = useInvalidateCache()

  const submit = useCallback(
    async (items: KnowledgeAddItemInput[]): Promise<void> => {
      if (!baseId) {
        return Promise.reject(new Error('Knowledge base id is required'))
      }

      if (items.length === 0) {
        return Promise.reject(new Error('At least one knowledge source must be selected'))
      }

      setError(undefined)
      setIsSubmitting(true)

      let submitError: Error | undefined
      try {
        await ipcApi.request('knowledge.add_items', { baseId, items })
      } catch (error) {
        submitError = normalizeKnowledgeError(error)

        addLogger.error('Failed to add knowledge sources', submitError, {
          baseId,
          sourceCount: items.length
        })

        setError(submitError)
      } finally {
        await refreshKnowledgeItemsCaches(
          invalidateCache,
          baseId,
          addLogger,
          'Failed to refresh knowledge source list after submit',
          { baseId }
        )

        setIsSubmitting(false)
      }

      if (submitError) {
        throw submitError
      }
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
