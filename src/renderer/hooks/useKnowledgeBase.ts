import { useInvalidateCache, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import { KNOWLEDGE_BASES_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import type { CreateKnowledgeBaseDto, RestoreKnowledgeBaseDto } from '@shared/data/types/knowledge'
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
>
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

      if (!name) {
        throw new Error('Knowledge base name is required')
      }

      // A base is BM25-only by default and gets its embedding model later from the
      // RAG settings. The one exception is creation-time backfill: the create dialog
      // passes the local embedding model (paired with its dimensions) when it is
      // already downloaded, so the base starts as a vector base. Keep the pair intact
      // — the create schema rejects one without the other.
      const body: {
        name: string
        groupId?: string
        embeddingModelId?: string
        dimensions?: number
      } = {
        name
      }

      if (groupId) {
        body.groupId = groupId
      }

      if (input.embeddingModelId && input.dimensions) {
        body.embeddingModelId = input.embeddingModelId
        body.dimensions = input.dimensions
      }

      setIsCreating(true)

      try {
        const createdBase = await ipcApi.request('knowledge.create_base', { base: body })

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
          groupId
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
        const result = await ipcApi.request('knowledge.restore_base', {
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
            restoredBaseId: result.base.id
          })
        }

        setIsRestoring(false)
        return result
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

export const useEnableKnowledgeBaseEmbedding = () => {
  const [isEnabling, setIsEnabling] = useState(false)
  const [enableError, setEnableError] = useState<Error | undefined>()
  const invalidateCache = useInvalidateCache()

  const enableEmbedding = useCallback(
    async (baseId: string, patch: UpdateKnowledgeBaseDto) => {
      setEnableError(undefined)

      const trimmedBaseId = baseId.trim()
      const embeddingModelId = patch.embeddingModelId?.trim()
      const dimensions = patch.dimensions

      if (!trimmedBaseId) {
        throw new Error('Knowledge base id is required')
      }

      if (!embeddingModelId) {
        throw new Error('Knowledge base embedding model is required')
      }

      if (!Number.isInteger(dimensions) || (dimensions as number) <= 0) {
        throw new Error(`Knowledge base dimensions must be a positive integer, received "${dimensions}"`)
      }

      setIsEnabling(true)

      try {
        const result = await ipcApi.request('knowledge.enable_embedding_model', {
          baseId: trimmedBaseId,
          patch: { ...patch, embeddingModelId, dimensions }
        })

        try {
          // Also invalidate the item list: enabling embedding flips every existing item back to
          // processing/embedding server-side, but the item list's own polling already stopped
          // once they last reached a terminal status (see useKnowledgeItems' hasNonTerminalItem) —
          // without this, the UI keeps showing the stale "completed" badges from the BM25-only run.
          await invalidateCache([`/knowledge-bases/${trimmedBaseId}/items`, '/knowledge-bases'])
        } catch (invalidateError) {
          logger.error(
            'Failed to refresh knowledge base list after enabling embedding',
            normalizeError(invalidateError),
            { baseId: trimmedBaseId }
          )
        }

        setIsEnabling(false)
        return result
      } catch (error) {
        const normalizedError = normalizeError(error)
        logger.error('Failed to enable knowledge base embedding', normalizedError, {
          baseId: trimmedBaseId,
          embeddingModelId
        })
        setEnableError(normalizedError)
        setIsEnabling(false)
        throw normalizedError
      }
    },
    [invalidateCache]
  )

  return {
    enableEmbedding,
    isEnabling,
    enableError
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
      let mutationError: Error | undefined

      try {
        await ipcApi.request('knowledge.delete_base', { baseId })
      } catch (error) {
        const normalizedError = normalizeError(error)
        logger.error('Failed to delete knowledge base', normalizedError, {
          baseId
        })
        setDeleteError(normalizedError)
        mutationError = normalizedError
      }

      try {
        await invalidateCache(['/knowledge-bases', '/agents', '/agents/*'])
      } catch (invalidateError) {
        logger.error('Failed to refresh dependent data after knowledge base delete', normalizeError(invalidateError), {
          baseId
        })
      }

      setIsDeleting(false)

      if (mutationError) {
        throw mutationError
      }
    },
    [invalidateCache]
  )

  return {
    deleteBase,
    isDeleting,
    deleteError
  }
}
