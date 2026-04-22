import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { KNOWLEDGE_BASES_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import { useCallback, useMemo } from 'react'

import type { CreateKnowledgeBaseInput } from '../types'

const KNOWLEDGE_V2_BASES_QUERY = {
  page: 1,
  limit: KNOWLEDGE_BASES_MAX_LIMIT
} as const

const logger = loggerService.withContext('useCreateKnowledgeBase')

export const useKnowledgeBases = () => {
  const { data, isLoading, error, refetch } = useQuery('/knowledge-bases', {
    query: KNOWLEDGE_V2_BASES_QUERY
  })

  const bases = useMemo(() => data?.items ?? [], [data])

  return {
    bases,
    isLoading,
    error,
    refetch
  }
}

export const useCreateKnowledgeBase = () => {
  const {
    trigger: createTrigger,
    isLoading: isCreating,
    error: createError
  } = useMutation('POST', '/knowledge-bases', {
    refresh: ['/knowledge-bases']
  })

  const createBase = useCallback(
    async (input: CreateKnowledgeBaseInput) => {
      const name = input.name.trim()
      const embeddingModelId = input.embeddingModelId?.trim()
      const dimensions = Number(input.dimensions)

      if (!name) {
        throw new Error('Knowledge base name is required')
      }

      if (!embeddingModelId) {
        throw new Error('Knowledge base embedding model is required')
      }

      if (!Number.isInteger(dimensions) || dimensions <= 0) {
        throw new Error(`Knowledge base dimensions must be a positive integer, received "${input.dimensions}"`)
      }

      try {
        return await createTrigger({
          body: {
            name,
            emoji: input.emoji,
            embeddingModelId,
            dimensions
          }
        })
      } catch (error) {
        logger.error('Failed to create knowledge base', {
          name,
          embeddingModelId,
          error
        })
        throw error
      }
    },
    [createTrigger]
  )

  return {
    createBase,
    isCreating,
    createError
  }
}
