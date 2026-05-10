import { useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { useCallback, useState } from 'react'

import { normalizeKnowledgeError } from '../utils'

const logger = loggerService.withContext('useReindexKnowledgeItem')

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
          logger.error(
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

        logger.error('Failed to reindex knowledge source', reindexError, {
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
