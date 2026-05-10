import { useInvalidateCache, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { KNOWLEDGE_ITEMS_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeItem, KnowledgeItemStatus, KnowledgeRuntimeAddItemInput } from '@shared/data/types/knowledge'
import { useCallback, useEffect, useRef, useState } from 'react'

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
  const isMountedRef = useRef(true)
  const invalidateCache = useInvalidateCache()

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const submit = useCallback(
    async (items: KnowledgeRuntimeAddItemInput[]): Promise<void> => {
      if (!baseId) {
        return Promise.reject(new Error('Knowledge base id is required'))
      }

      if (items.length === 0) {
        return Promise.reject(new Error('At least one knowledge source must be selected'))
      }

      if (isMountedRef.current) {
        setError(undefined)
        setIsSubmitting(true)
      }

      try {
        await window.api.knowledgeRuntime.addItems(baseId, items)

        try {
          await invalidateCache(`/knowledge-bases/${baseId}/items`)
        } catch (invalidateError) {
          addLogger.error(
            'Failed to refresh knowledge source list after submit',
            normalizeKnowledgeError(invalidateError),
            {
              baseId
            }
          )
        }

        if (isMountedRef.current) {
          setIsSubmitting(false)
        }
      } catch (error) {
        const submitError = normalizeKnowledgeError(error)

        addLogger.error('Failed to add knowledge sources', submitError, {
          baseId,
          sourceCount: items.length
        })

        if (isMountedRef.current) {
          setError(submitError)
          setIsSubmitting(false)
        }

        return Promise.reject(submitError)
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

      try {
        await window.api.knowledgeRuntime.deleteItems(baseId, [item.id])

        try {
          await invalidateCache(`/knowledge-bases/${baseId}/items`)
        } catch (invalidateError) {
          deleteLogger.error(
            'Failed to refresh knowledge source list after delete',
            normalizeKnowledgeError(invalidateError),
            {
              baseId,
              itemId: item.id
            }
          )
        }

        setIsDeleting(false)
      } catch (error) {
        const deleteError = normalizeKnowledgeError(error)

        deleteLogger.error('Failed to delete knowledge source', deleteError, {
          baseId,
          itemId: item.id
        })

        setError(deleteError)
        setIsDeleting(false)
        return Promise.reject(deleteError)
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

      try {
        await window.api.knowledgeRuntime.reindexItems(baseId, [item.id])

        try {
          await invalidateCache(`/knowledge-bases/${baseId}/items`)
        } catch (invalidateError) {
          reindexLogger.error(
            'Failed to refresh knowledge source list after reindex',
            normalizeKnowledgeError(invalidateError),
            {
              baseId,
              itemId: item.id
            }
          )
        }

        setIsReindexing(false)
      } catch (error) {
        const reindexError = normalizeKnowledgeError(error)

        reindexLogger.error('Failed to reindex knowledge source', reindexError, {
          baseId,
          itemId: item.id
        })

        setError(reindexError)
        setIsReindexing(false)
        return Promise.reject(reindexError)
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
