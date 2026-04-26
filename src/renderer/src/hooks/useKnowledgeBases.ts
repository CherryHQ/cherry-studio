import { useInvalidateCache, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { CreateKnowledgeBaseDto, UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import { KNOWLEDGE_BASES_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import { useCallback, useMemo, useState } from 'react'

const KNOWLEDGE_V2_BASES_QUERY = {
  page: 1,
  limit: KNOWLEDGE_BASES_MAX_LIMIT
} as const

const logger = loggerService.withContext('useKnowledgeBases')

export type CreateKnowledgeBaseInput = Pick<
  CreateKnowledgeBaseDto,
  'name' | 'emoji' | 'groupId' | 'embeddingModelId' | 'dimensions'
>

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
      const groupId = input.groupId?.trim()
      const embeddingModelId = input.embeddingModelId?.trim()
      const dimensions = input.dimensions

      if (!name) {
        throw new Error('Knowledge base name is required')
      }

      if (!embeddingModelId) {
        throw new Error('Knowledge base embedding model is required')
      }

      if (!Number.isInteger(dimensions) || dimensions <= 0) {
        throw new Error(`Knowledge base dimensions must be a positive integer, received "${input.dimensions}"`)
      }

      const body: {
        name: string
        emoji: string
        embeddingModelId: string
        dimensions: number
        groupId?: string
      } = {
        name,
        emoji: input.emoji,
        embeddingModelId,
        dimensions
      }

      if (groupId) {
        body.groupId = groupId
      }

      try {
        return await createTrigger({ body })
      } catch (error) {
        logger.error('Failed to create knowledge base', {
          name,
          groupId,
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

export const useUpdateKnowledgeBase = () => {
  const {
    trigger: updateTrigger,
    isLoading: isUpdating,
    error: updateError
  } = useMutation('PATCH', '/knowledge-bases/:id', {
    refresh: ['/knowledge-bases']
  })

  const updateBase = useCallback(
    async (baseId: string, updates: UpdateKnowledgeBaseDto) => {
      try {
        return await updateTrigger({
          params: { id: baseId },
          body: updates
        })
      } catch (error) {
        logger.error('Failed to update knowledge base', {
          baseId,
          updates,
          error
        })
        throw error
      }
    },
    [updateTrigger]
  )

  return {
    updateBase,
    isUpdating,
    updateError
  }
}

export const useDeleteKnowledgeBase = () => {
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<Error | undefined>()
  const invalidateCache = useInvalidateCache()

  const deleteBase = useCallback(
    async (baseId: string) => {
      setDeleteError(undefined)
      setIsDeleting(true)

      try {
        await window.api.knowledgeRuntime.deleteBase(baseId)
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error('Failed to delete knowledge base')
        logger.error('Failed to delete knowledge base', {
          baseId,
          error: normalizedError
        })
        setDeleteError(normalizedError)
        setIsDeleting(false)
        throw normalizedError
      }

      try {
        await invalidateCache('/knowledge-bases')
      } catch (invalidateError) {
        logger.error('Failed to refresh knowledge base list after delete', {
          baseId,
          error: invalidateError instanceof Error ? invalidateError : new Error('Failed to refresh knowledge bases')
        })
      }

      setIsDeleting(false)
    },
    [invalidateCache]
  )

  return {
    deleteBase,
    isDeleting,
    deleteError
  }
}
