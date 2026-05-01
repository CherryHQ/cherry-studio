import { useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { useCallback, useState } from 'react'

const logger = loggerService.withContext('useReindexKnowledgeItem')

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
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
          logger.error('Failed to refresh knowledge source list after reindex', {
            baseId,
            itemId: item.id,
            error: normalizeError(invalidateError)
          })
        }

        setIsReindexing(false)
      } catch (error) {
        const reindexError = normalizeError(error)

        logger.error('Failed to reindex knowledge source', {
          baseId,
          itemId: item.id,
          error: reindexError
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
