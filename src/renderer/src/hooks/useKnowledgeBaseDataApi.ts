/**
 * DataApi-backed knowledge base queries and mutations.
 *
 * Returns the canonical {@link KnowledgeBase} entity straight from SQLite via
 * `/knowledge-bases`. No v1 shape adaptation — consumers are expected to use
 * the v2 shape directly.
 *
 * Companion to {@link useTopicDataApi} / {@link useAssistantDataApi}.
 */

import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import type { CreateKnowledgeBaseDto, KnowledgeBase } from '@shared/data/types/knowledge'
import { useCallback } from 'react'

const logger = loggerService.withContext('useKnowledgeBaseDataApi')

const KB_LIST_LIMIT = 100

const EMPTY_KNOWLEDGE_BASES: readonly KnowledgeBase[] = Object.freeze([])

const KB_REFRESH_KEYS: ConcreteApiPaths[] = ['/knowledge-bases', '/knowledge-bases/*']

/**
 * List knowledge bases from SQLite via DataApi. Single-page fetch — the schema
 * caps the response at {@link KB_LIST_LIMIT}; paginated UI would need a different
 * consumer.
 */
export function useKnowledgeBases() {
  const { data, isLoading, error, refetch, mutate } = useQuery('/knowledge-bases', {
    query: { limit: KB_LIST_LIMIT }
  })

  return {
    knowledgeBases: data?.items ?? EMPTY_KNOWLEDGE_BASES,
    total: data?.total ?? 0,
    isLoading,
    error,
    refetch,
    mutate
  }
}

/**
 * Fetch a single knowledge base by id from SQLite via DataApi.
 */
export function useKnowledgeBaseById(id: string | undefined) {
  const { data, isLoading, error, refetch, mutate } = useQuery('/knowledge-bases/:id', {
    params: { id: id ?? '' },
    enabled: !!id
  })

  return {
    knowledgeBase: data,
    isLoading,
    error,
    refetch,
    mutate
  }
}

/**
 * Knowledge-base mutations (create / update / delete) backed by DataApi.
 */
export function useKnowledgeBaseMutations() {
  const { trigger: createTrigger, isLoading: isCreating } = useMutation('POST', '/knowledge-bases', {
    refresh: KB_REFRESH_KEYS
  })
  const { trigger: updateTrigger, isLoading: isUpdating } = useMutation('PATCH', '/knowledge-bases/:id', {
    refresh: KB_REFRESH_KEYS
  })
  const { trigger: deleteTrigger, isLoading: isDeleting } = useMutation('DELETE', '/knowledge-bases/:id', {
    refresh: KB_REFRESH_KEYS
  })

  const createKnowledgeBase = useCallback(
    async (dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> => {
      const created = await createTrigger({ body: dto })
      logger.info('Created knowledge base', { id: created.id })
      return created
    },
    [createTrigger]
  )

  const updateKnowledgeBase = useCallback(
    async (id: string, dto: UpdateKnowledgeBaseDto): Promise<KnowledgeBase> => {
      const updated = await updateTrigger({ params: { id }, body: dto })
      logger.info('Updated knowledge base', { id })
      return updated
    },
    [updateTrigger]
  )

  const deleteKnowledgeBase = useCallback(
    async (id: string): Promise<void> => {
      await deleteTrigger({ params: { id } })
      logger.info('Deleted knowledge base', { id })
    },
    [deleteTrigger]
  )

  return {
    createKnowledgeBase,
    updateKnowledgeBase,
    deleteKnowledgeBase,
    isCreating,
    isUpdating,
    isDeleting
  }
}
