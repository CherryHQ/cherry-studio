import { useCallback } from 'react'

import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { resolveTemplate } from '@renderer/data/utils/dataApiPath'
import type { ConcreteApiPaths } from '@shared/data/api/paths'
import type { CreatePromptDto, PromptBindingParams, UpdatePromptDto } from '@shared/data/api/schemas/prompts'
import type { Prompt, PromptBindingTarget } from '@shared/data/types/prompt'

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
    refresh: ['/prompts', '/prompt-bindings']
  })
  const { trigger: deleteTrigger } = useMutation('DELETE', path, {
    refresh: ['/prompts', '/prompt-bindings']
  })

  const updatePrompt = useCallback(
    (dto: UpdatePromptDto): Promise<Prompt> => updateTrigger({ body: dto }),
    [updateTrigger]
  )
  const deletePrompt = useCallback((): Promise<void> => deleteTrigger().then(() => undefined), [deleteTrigger])

  return { updatePrompt, deletePrompt }
}

function getPromptBindingCollectionPath(target: PromptBindingTarget) {
  return resolveTemplate('/prompt-bindings/:targetType/:targetId', {
    targetType: target.type,
    targetId: target.id
  }) as ConcreteApiPaths
}

function getPromptBindingRefreshPaths(params: PromptBindingParams): ConcreteApiPaths[] {
  const target: PromptBindingTarget =
    params.targetType === 'assistant'
      ? { type: 'assistant', id: params.targetId }
      : { type: 'agent', id: params.targetId }
  return [
    '/prompts',
    '/prompt-bindings',
    getPromptBindingCollectionPath(target),
    `/prompts/${params.id}/bindings` as ConcreteApiPaths
  ]
}

export function usePromptBindingMutations(target: PromptBindingTarget) {
  const { trigger: bindTrigger } = useMutation('PUT', '/prompts/:id/bindings/:targetType/:targetId', {
    refresh: ({ args }) => getPromptBindingRefreshPaths(args!.params)
  })
  const { trigger: unbindTrigger } = useMutation('DELETE', '/prompts/:id/bindings/:targetType/:targetId', {
    refresh: ({ args }) => getPromptBindingRefreshPaths(args!.params)
  })

  const bindPrompt = useCallback(
    (id: string): Promise<void> =>
      bindTrigger({ params: { id, targetType: target.type, targetId: target.id } }).then(() => undefined),
    [bindTrigger, target.id, target.type]
  )
  const unbindPrompt = useCallback(
    (id: string): Promise<void> =>
      unbindTrigger({ params: { id, targetType: target.type, targetId: target.id } }).then(() => undefined),
    [target.id, target.type, unbindTrigger]
  )

  return { bindPrompt, unbindPrompt }
}

export function usePromptTargetMutations(promptId: string) {
  const { trigger: bindTrigger } = useMutation('PUT', '/prompts/:id/bindings/:targetType/:targetId', {
    refresh: ({ args }) => getPromptBindingRefreshPaths(args!.params)
  })
  const { trigger: unbindTrigger } = useMutation('DELETE', '/prompts/:id/bindings/:targetType/:targetId', {
    refresh: ({ args }) => getPromptBindingRefreshPaths(args!.params)
  })

  const bindTarget = useCallback(
    (target: PromptBindingTarget): Promise<void> =>
      bindTrigger({
        params: { id: promptId, targetType: target.type, targetId: target.id }
      }).then(() => undefined),
    [bindTrigger, promptId]
  )
  const unbindTarget = useCallback(
    (target: PromptBindingTarget): Promise<void> =>
      unbindTrigger({
        params: { id: promptId, targetType: target.type, targetId: target.id }
      }).then(() => undefined),
    [promptId, unbindTrigger]
  )

  return { bindTarget, unbindTarget }
}
