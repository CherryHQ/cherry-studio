import { useMutation, useQuery } from '@data/hooks/useDataApi'
import {
  ASSISTANTS_MAX_LIMIT,
  type CreateAssistantDto,
  type ImportAssistantDto,
  type UpdateAssistantDto
} from '@shared/data/api/schemas/assistants'
import type { Assistant } from '@shared/data/types/assistant'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import type { ResourceAdapter, ResourceListQuery, ResourceListResult } from './types'

/**
 * Server-backed list hook. `search` / `groupId` are forwarded to
 * `GET /assistants` query params and evaluated in SQL (see
 * `AssistantService.list`) so no client-side chain-filtering is needed.
 */
function useAssistantList(query?: ResourceListQuery): ResourceListResult<Assistant> {
  const { data, isLoading, isRefreshing, error, refetch } = useQuery('/assistants', {
    enabled: query?.enabled !== false,
    query: {
      limit: query?.limit ?? ASSISTANTS_MAX_LIMIT,
      ...(query?.search ? { search: query.search } : {}),
      ...(query?.groupId ? { groupId: query.groupId } : {})
    }
  })

  const items = data?.items ?? []
  const stableRefetch = useCallback(() => refetch(), [refetch])

  return {
    data: items,
    isLoading,
    isRefreshing,
    error,
    refetch: stableRefetch
  }
}

export const assistantAdapter: ResourceAdapter<Assistant> = {
  resource: 'assistant',
  useList: useAssistantList
}

/**
 * Write-side hook for assistant resources — mirrors `useMcpServerMutations` pattern.
 * Every mutation triggers refresh of `/assistants` so the library list picks up
 * new/updated/deleted rows automatically.
 */
export function useAssistantMutations() {
  const { t } = useTranslation()
  const { trigger: createTrigger } = useMutation('POST', '/assistants', {
    refresh: ['/assistants']
  })

  const createAssistant = useCallback(
    (dto: CreateAssistantDto): Promise<Assistant> => createTrigger({ body: dto }),
    [createTrigger]
  )

  /**
   * Duplicate an assistant by re-POSTing its full state (plus a "(副本)" suffix)
   * in a single request. The single group assignment is copied as a regular
   * assistant column.
   */
  const duplicateAssistant = useCallback(
    async (source: Assistant): Promise<Assistant> => {
      const duplicateName = t('library.duplicate_name', { name: source.name })

      return createTrigger({
        body: {
          name: duplicateName,
          prompt: source.prompt,
          emoji: source.emoji,
          description: source.description,
          modelId: source.modelId,
          settings: source.settings,
          mcpServerIds: source.mcpServerIds,
          knowledgeBaseIds: source.knowledgeBaseIds,
          groupId: source.groupId
        }
      })
    },
    [createTrigger, t]
  )

  return { createAssistant, duplicateAssistant }
}

/**
 * Legacy import is a dedicated mutation because the server resolves/creates
 * the optional group and inserts the assistant in one transaction.
 */
export function useImportAssistantMutation() {
  const { trigger } = useMutation('POST', '/assistants:import', {
    refresh: ['/assistants', '/groups']
  })

  const importAssistant = useCallback(
    (dto: ImportAssistantDto): Promise<Assistant> => trigger({ body: dto }),
    [trigger]
  )

  return { importAssistant }
}

/**
 * Mutation hook scoped to a single assistant id — no read, use alongside list data.
 * PATCH accepts `groupId` alongside the other assistant fields.
 */
export function useAssistantMutationsById(id: string) {
  const path = `/assistants/${id}` as const

  const { trigger: updateTrigger } = useMutation('PATCH', path, {
    refresh: ['/assistants', '/assistants/*']
  })
  const { trigger: deleteTrigger } = useMutation('DELETE', path, {
    refresh: ['/assistants', '/assistants/*', '/pins']
  })

  const updateAssistant = useCallback(
    (dto: UpdateAssistantDto): Promise<Assistant> => updateTrigger({ body: dto }),
    [updateTrigger]
  )
  const deleteAssistant = useCallback((): Promise<void> => deleteTrigger().then(() => undefined), [deleteTrigger])

  return { updateAssistant, deleteAssistant }
}
