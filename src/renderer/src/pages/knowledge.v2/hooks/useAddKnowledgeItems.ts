import { useInvalidateCache } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { KnowledgeRuntimeAddItemInput } from '@shared/data/types/knowledge'
import { useCallback, useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('useAddKnowledgeItems')

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
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
          logger.error('Failed to refresh knowledge source list after submit', {
            baseId,
            error: normalizeError(invalidateError)
          })
        }

        if (isMountedRef.current) {
          setIsSubmitting(false)
        }
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
