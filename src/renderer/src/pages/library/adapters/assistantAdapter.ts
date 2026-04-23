import { useMutation, useQuery } from '@data/hooks/useDataApi'
import type { CreateAssistantDto, UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { Assistant } from '@shared/data/types/assistant'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import type { ResourceAdapter, ResourceListQuery, ResourceListResult } from './types'

/**
 * Default page size for the library list view. Matches the backend schema's
 * `limit` max (`packages/shared/data/api/schemas/assistants.ts` caps at 500)
 * so the library grid surfaces every assistant without a pagination UI.
 * If total assistant count ever exceeds 500 we'll need to add paging here.
 */
const DEFAULT_LIST_LIMIT = 500

/**
 * Server-backed list hook. `search` / `tagIds` are forwarded to
 * `GET /assistants` query params and evaluated in SQL (see
 * `AssistantService.list`) so no client-side chain-filtering is needed.
 */
function useAssistantList(query?: ResourceListQuery): ResourceListResult<Assistant> {
  const { data, isLoading, isRefreshing, error, refetch } = useQuery('/assistants', {
    query: {
      limit: query?.limit ?? DEFAULT_LIST_LIMIT,
      ...(query?.search ? { search: query.search } : {}),
      ...(query?.tagIds && query.tagIds.length > 0 ? { tagIds: query.tagIds } : {})
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
 * Write-side hook for assistant resources — mirrors `useMCPServerMutations` pattern.
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
   * in a single request. Tag bindings are carried via `tagIds` in the create DTO
   * so the backend lands them in the same transaction as the assistant row —
   * no half-success state, no follow-up tag-bind call.
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
          tagIds: source.tags.map((tag) => tag.id)
        }
      })
    },
    [createTrigger, t]
  )

  return { createAssistant, duplicateAssistant }
}

/**
 * Mutation hook scoped to a single assistant id — no read, use alongside list data.
 * PATCH accepts `tagIds` (alongside other fields); the backend diff-syncs the
 * `entity_tag` junction inside the assistant-row transaction so callers never
 * observe the assistant in a desynced state.
 */
export function useAssistantMutationsById(id: string) {
  const path = `/assistants/${id}` as const

  const { trigger: updateTrigger } = useMutation('PATCH', path, {
    refresh: ['/assistants']
  })
  const { trigger: deleteTrigger } = useMutation('DELETE', path, {
    refresh: ['/assistants']
  })

  const updateAssistant = useCallback(
    (dto: UpdateAssistantDto): Promise<Assistant> => updateTrigger({ body: dto }),
    [updateTrigger]
  )
  const deleteAssistant = useCallback((): Promise<void> => deleteTrigger().then(() => undefined), [deleteTrigger])

  return { updateAssistant, deleteAssistant }
}
