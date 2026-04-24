import { useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { CreateKnowledgeItemsDto } from '@shared/data/api/schemas/knowledges'
import { useCallback, useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('useAddKnowledgeSources')

export type AddKnowledgeSourcesSubmitResult = {
  itemIds: string[]
}

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }

  return new Error('Failed to add the selected knowledge sources')
}

export const useAddKnowledgeSources = (baseId: string) => {
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
    async (items: CreateKnowledgeItemsDto['items']): Promise<AddKnowledgeSourcesSubmitResult> => {
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
        const result = await window.api.knowledgeRuntime.addSources(baseId, items)

        try {
          await invalidateCache(`/knowledge-bases/${baseId}/items`)
        } catch (invalidateError) {
          logger.error('Failed to refresh knowledge source list after submit', {
            baseId,
            itemIds: result.itemIds,
            error: normalizeError(invalidateError)
          })
        }

        if (isMountedRef.current) {
          setIsSubmitting(false)
        }

        return result
      } catch (error) {
        const submitError = normalizeError(error)

        logger.error('Failed to add knowledge sources', {
          baseId,
          sourceCount: items.length,
          error: submitError
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
