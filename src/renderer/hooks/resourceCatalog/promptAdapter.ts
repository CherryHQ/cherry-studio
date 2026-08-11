import { useMutation, useQuery } from '@data/hooks/useDataApi'
import type { CreatePromptDto, UpdatePromptDto } from '@shared/data/api/schemas/prompts'
import type { Prompt, PromptBindingTarget } from '@shared/data/types/prompt'
import { useCallback } from 'react'

import type { ResourceAdapter, ResourceListQuery, ResourceListResult } from './types'

function usePromptList(query?: ResourceListQuery): ResourceListResult<Prompt> {
  const { data, isLoading, isRefreshing, error, refetch } = useQuery('/prompts', {
    enabled: query?.enabled !== false,
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

export function usePromptBindingMutations() {
  const { trigger: bindTrigger } = useMutation('PUT', '/prompts/:id/bindings/:targetType/:targetId', {
    refresh: ['/prompts']
  })
  const { trigger: unbindTrigger } = useMutation('DELETE', '/prompts/:id/bindings/:targetType/:targetId', {
    refresh: ['/prompts']
  })

  const bindPrompt = useCallback(
    (id: string, target: PromptBindingTarget): Promise<void> =>
      bindTrigger({ params: { id, targetType: target.type, targetId: target.id } }).then(() => undefined),
    [bindTrigger]
  )
  const unbindPrompt = useCallback(
    (id: string, target: PromptBindingTarget): Promise<void> =>
      unbindTrigger({ params: { id, targetType: target.type, targetId: target.id } }).then(() => undefined),
    [unbindTrigger]
  )

  return { bindPrompt, unbindPrompt }
}
