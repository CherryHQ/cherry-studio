import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { useAssistantMutations } from '@renderer/hooks/useAssistant'
import {
  ASSISTANTS_MAX_LIMIT,
  type ImportAssistantDto,
  type UpdateAssistantDto
} from '@shared/data/api/schemas/assistants'
import type { Assistant } from '@shared/data/types/assistant'

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
 * Duplication lives apart from `useAssistantMutations` because its localized
 * name would subscribe every `useAssistant` caller to language changes.
 */
export function useDuplicateAssistantMutation() {
  const { t } = useTranslation()
  const { trigger: duplicateTrigger } = useMutation('POST', '/assistants/:id/duplicate', {
    refresh: ['/assistants', '/prompts', '/prompt-bindings']
  })

  const duplicateAssistant = useCallback(
    async (source: Assistant): Promise<Assistant> => {
      const duplicateName = t('library.duplicate_name', { name: source.name })

      return duplicateTrigger({
        params: { id: source.id },
        body: { name: duplicateName }
      })
    },
    [duplicateTrigger, t]
  )

  return { duplicateAssistant }
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
  const { updateAssistant: updateById, deleteAssistant: deleteById } = useAssistantMutations()

  const updateAssistant = useCallback(
    (dto: UpdateAssistantDto, metadata?: { source?: string; operationId?: string }) =>
      metadata ? updateById(id, dto, metadata) : updateById(id, dto),
    [id, updateById]
  )
  const deleteAssistant = useCallback(
    (options?: { deleteTopics?: boolean; permanent?: boolean }) => deleteById(id, options),
    [deleteById, id]
  )

  return { updateAssistant, deleteAssistant }
}
