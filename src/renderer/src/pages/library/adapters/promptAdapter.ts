import { useMutation, useQuery } from '@data/hooks/useDataApi'
import type { CreatePromptDto, UpdatePromptDto } from '@shared/data/api/schemas/prompts'
import type { Prompt } from '@shared/data/types/prompt'
import { useCallback } from 'react'

import type { ResourceAdapter, ResourceListQuery, ResourceListResult } from './types'

function usePromptList(query?: ResourceListQuery): ResourceListResult<Prompt> {
  const { data, isLoading, isRefreshing, error, refetch } = useQuery('/prompts', {
    query: {
      ...(query?.search ? { search: query.search } : {})
    }
  })

  const stableRefetch = useCallback(() => refetch(), [refetch])

  return {
    data: data ?? [],
    isLoading,
    isRefreshing,
    error,
    refetch: stableRefetch
  }
}

export const promptAdapter: ResourceAdapter<Prompt> = {
  resource: 'prompt',
  useList: usePromptList
}

export function usePromptMutations() {
  const { trigger: createTrigger } = useMutation('POST', '/prompts', {
    refresh: ['/prompts']
  })

  const createPrompt = useCallback(
    (dto: CreatePromptDto): Promise<Prompt> => createTrigger({ body: dto }),
    [createTrigger]
  )

  return { createPrompt }
}

export function usePromptMutationsById(id: string) {
  const path = `/prompts/${id}` as const

  const { trigger: updateTrigger } = useMutation('PATCH', path, {
    refresh: ['/prompts']
  })
  const { trigger: deleteTrigger } = useMutation('DELETE', path, {
    refresh: ['/prompts']
  })

  const updatePrompt = useCallback(
    (dto: UpdatePromptDto): Promise<Prompt> => updateTrigger({ body: dto }),
    [updateTrigger]
  )
  const deletePrompt = useCallback((): Promise<void> => deleteTrigger().then(() => undefined), [deleteTrigger])

  return { updatePrompt, deletePrompt }
}
