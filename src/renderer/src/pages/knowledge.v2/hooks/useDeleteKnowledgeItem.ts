import { useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { useCallback, useState } from 'react'

const logger = loggerService.withContext('useDeleteKnowledgeItem')

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }

  return new Error('Failed to delete the selected knowledge source')
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
          logger.error('Failed to refresh knowledge source list after delete', {
            baseId,
            itemId: item.id,
            error: normalizeError(invalidateError)
          })
        }

        setIsDeleting(false)
      } catch (error) {
        const deleteError = normalizeError(error)

        logger.error('Failed to delete knowledge source', {
          baseId,
          itemId: item.id,
          error: deleteError
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
