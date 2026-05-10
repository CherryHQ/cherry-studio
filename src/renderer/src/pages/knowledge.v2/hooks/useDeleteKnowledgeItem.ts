import { useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { useCallback, useState } from 'react'

import { normalizeKnowledgeError } from '../utils'

const logger = loggerService.withContext('useDeleteKnowledgeItem')

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
          logger.error(
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

        logger.error('Failed to delete knowledge source', deleteError, {
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
