import { useInvalidateCache, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import { KNOWLEDGE_BASES_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import type { CreateKnowledgeBaseDto, KnowledgeBaseEmoji, RestoreKnowledgeBaseDto } from '@shared/data/types/knowledge'
import { useCallback, useMemo, useState } from 'react'

const KNOWLEDGE_V2_BASES_QUERY = {
  page: 1,
  limit: KNOWLEDGE_BASES_MAX_LIMIT
} as const

const logger = loggerService.withContext('useKnowledgeBases')

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}

export type CreateKnowledgeBaseInput = Pick<
  CreateKnowledgeBaseDto,
  'name' | 'groupId' | 'embeddingModelId' | 'dimensions'
> & {
  emoji: KnowledgeBaseEmoji
}
export type RestoreKnowledgeBaseInput = Pick<
  RestoreKnowledgeBaseDto,
  'sourceBaseId' | 'name' | 'embeddingModelId' | 'dimensions'
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
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<Error | undefined>()
  const invalidateCache = useInvalidateCache()

  const createBase = useCallback(
    async (input: CreateKnowledgeBaseInput) => {
      setCreateError(undefined)

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
        emoji: KnowledgeBaseEmoji
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

      setIsCreating(true)

      try {
        const createdBase = await window.api.knowledgeRuntime.createBase(body)

        try {
          await invalidateCache('/knowledge-bases')
        } catch (invalidateError) {
          logger.error('Failed to refresh knowledge base list after create', normalizeError(invalidateError), {
            baseId: createdBase.id
          })
        }

        setIsCreating(false)
        return createdBase
      } catch (error) {
        const normalizedError = normalizeError(error)
        logger.error('Failed to create knowledge base', normalizedError, {
          name,
          groupId,
          embeddingModelId
        })
        setCreateError(normalizedError)
        setIsCreating(false)
        throw normalizedError
      }
    },
    [invalidateCache]
  )

  return {
    createBase,
    isCreating,
    createError
  }
}

export const useRestoreKnowledgeBase = () => {
  const [isRestoring, setIsRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<Error | undefined>()
  const invalidateCache = useInvalidateCache()

  const restoreBase = useCallback(
    async (input: RestoreKnowledgeBaseInput) => {
      setRestoreError(undefined)

      const sourceBaseId = input.sourceBaseId.trim()
      const name = input.name?.trim()
      const embeddingModelId = input.embeddingModelId?.trim()
      const dimensions = input.dimensions

      if (!sourceBaseId) {
        throw new Error('Source knowledge base id is required')
      }

      if (!name) {
        throw new Error('Knowledge base name is required')
      }

      if (!embeddingModelId) {
        throw new Error('Knowledge base embedding model is required')
      }

      if (!Number.isInteger(dimensions) || dimensions <= 0) {
        throw new Error(`Knowledge base dimensions must be a positive integer, received "${input.dimensions}"`)
      }

      setIsRestoring(true)

      try {
        const restoredBase = await window.api.knowledgeRuntime.restoreBase({
          sourceBaseId,
          name,
          embeddingModelId,
          dimensions
        })

        try {
          await invalidateCache('/knowledge-bases')
        } catch (invalidateError) {
          logger.error('Failed to refresh knowledge base list after restore', normalizeError(invalidateError), {
            sourceBaseId,
            restoredBaseId: restoredBase.id
          })
        }

        setIsRestoring(false)
        return restoredBase
      } catch (error) {
        const normalizedError = normalizeError(error)
        logger.error('Failed to restore knowledge base', normalizedError, {
          sourceBaseId,
          name,
          embeddingModelId
        })
        setRestoreError(normalizedError)
        setIsRestoring(false)
        throw normalizedError
      }
    },
    [invalidateCache]
  )

  return {
    restoreBase,
    isRestoring,
    restoreError
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
        const normalizedError = normalizeError(error)
        logger.error('Failed to update knowledge base', normalizedError, {
          baseId,
          updates
        })
        throw normalizedError
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
        const normalizedError = normalizeError(error)
        logger.error('Failed to delete knowledge base', normalizedError, {
          baseId
        })
        setDeleteError(normalizedError)
        setIsDeleting(false)
        throw normalizedError
      }

      try {
        await invalidateCache('/knowledge-bases')
      } catch (invalidateError) {
        logger.error('Failed to refresh knowledge base list after delete', normalizeError(invalidateError), {
          baseId
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
