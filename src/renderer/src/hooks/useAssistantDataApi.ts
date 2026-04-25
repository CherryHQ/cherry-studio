/**
 * DataApi-backed assistant queries and mutations.
 *
 * Returns the canonical {@link Assistant} entity straight from SQLite via
 * `/assistants`. No v1 shape adaptation — consumers are expected to use the
 * v2 shape directly (`modelId`, `mcpServerIds`, `knowledgeBaseIds`).
 *
 * Companion hooks for the entities Assistant references:
 *  - {@link import('./useTopicDataApi').useTopicsByAssistant} for topics
 *  - {@link import('./useModels').useModelById} for the model
 *  - {@link import('./useMCPServers').useMCPServer} for MCP servers
 *  - {@link import('./useKnowledgeBaseDataApi').useKnowledgeBaseById} for KBs
 */

import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { CreateAssistantDto, UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { Assistant } from '@shared/data/types/assistant'
import { useCallback } from 'react'

const logger = loggerService.withContext('useAssistantDataApi')

const ASSISTANTS_LIST_LIMIT = 500

const EMPTY_ASSISTANTS: readonly Assistant[] = Object.freeze([])

const ASSISTANTS_REFRESH_KEYS: ConcreteApiPaths[] = ['/assistants', '/assistants/*']

/**
 * List all assistants from SQLite via DataApi.
 *
 * Returns up to {@link ASSISTANTS_LIST_LIMIT} assistants in a single fetch
 * (matches the schema's hard cap). Paginated UI would need a different
 * consumer.
 */
export function useAssistantsApi() {
  const { data, isLoading, error, refetch, mutate } = useQuery('/assistants', {
    query: { limit: ASSISTANTS_LIST_LIMIT }
  })

  return {
    assistants: data?.items ?? EMPTY_ASSISTANTS,
    total: data?.total ?? 0,
    isLoading,
    error,
    refetch,
    mutate
  }
}

/**
 * Fetch a single assistant by id from SQLite via DataApi.
 */
export function useAssistantApiById(id: string | undefined) {
  const { data, isLoading, error, refetch, mutate } = useQuery('/assistants/:id', {
    params: { id: id ?? '' },
    enabled: !!id
  })

  return {
    assistant: data,
    isLoading,
    error,
    refetch,
    mutate
  }
}

/**
 * Assistant mutations (create / update / delete) backed by DataApi.
 */
export function useAssistantMutations() {
  const { trigger: createTrigger, isLoading: isCreating } = useMutation('POST', '/assistants', {
    refresh: ASSISTANTS_REFRESH_KEYS
  })
  const { trigger: updateTrigger, isLoading: isUpdating } = useMutation('PATCH', '/assistants/:id', {
    refresh: ASSISTANTS_REFRESH_KEYS
  })
  const { trigger: deleteTrigger, isLoading: isDeleting } = useMutation('DELETE', '/assistants/:id', {
    refresh: ASSISTANTS_REFRESH_KEYS
  })

  const createAssistant = useCallback(
    async (dto: CreateAssistantDto): Promise<Assistant> => {
      const created = await createTrigger({ body: dto })
      logger.info('Created assistant', { id: created.id })
      return created
    },
    [createTrigger]
  )

  const updateAssistant = useCallback(
    async (id: string, dto: UpdateAssistantDto): Promise<Assistant> => {
      const updated = await updateTrigger({ params: { id }, body: dto })
      logger.info('Updated assistant', { id })
      return updated
    },
    [updateTrigger]
  )

  const deleteAssistant = useCallback(
    async (id: string): Promise<void> => {
      await deleteTrigger({ params: { id } })
      logger.info('Deleted assistant', { id })
    },
    [deleteTrigger]
  )

  return {
    createAssistant,
    updateAssistant,
    deleteAssistant,
    isCreating,
    isUpdating,
    isDeleting
  }
}
