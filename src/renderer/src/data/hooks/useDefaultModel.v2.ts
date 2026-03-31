import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import { useQuery } from './useDataApi'
import { usePreference } from './usePreference'

/**
 * Internal helper: resolve a UniqueModelId string into a Model via useQuery.
 * When uniqueModelId is undefined, the query is disabled (no request is made).
 */
function useResolveModel(uniqueModelId: string | undefined) {
  const parsed = uniqueModelId ? parseUniqueModelId(uniqueModelId as UniqueModelId) : null
  const { data, isLoading } = useQuery(`/models/${parsed?.providerId ?? ''}/${parsed?.modelId ?? ''}` as any, {
    enabled: !!parsed
  })
  return { model: data as Model | undefined, isLoading: !!parsed && isLoading }
}

export interface UseDefaultModelReturn {
  defaultModel?: Model
  defaultModelId: string
  quickModel?: Model
  quickModelId: string
  translateModel?: Model
  translateModelId: string
  isLoading: boolean
  setDefaultModel: (id: UniqueModelId) => Promise<void>
  setQuickModel: (id: UniqueModelId) => Promise<void>
  setTranslateModel: (id: UniqueModelId) => Promise<void>
}

/**
 * v2 replacement for the v1 useDefaultModel hook.
 *
 * v1 stored full Model objects in Redux state.
 * v2 stores UniqueModelId strings in Preferences and resolves them via useQuery.
 */
export function useDefaultModel(): UseDefaultModelReturn {
  const [defaultModelId, setDefaultModelId] = usePreference('model.default_id')
  const [quickModelId, setQuickModelId] = usePreference('model.quick_id')
  const [translateModelId, setTranslateModelId] = usePreference('model.translate_id')

  // Empty string → undefined to disable the query
  const { model: defaultModel, isLoading: loadingDefault } = useResolveModel(defaultModelId || undefined)
  const { model: quickModel, isLoading: loadingQuick } = useResolveModel(quickModelId || undefined)
  const { model: translateModel, isLoading: loadingTranslate } = useResolveModel(translateModelId || undefined)

  return {
    defaultModel,
    defaultModelId,
    quickModel,
    quickModelId,
    translateModel,
    translateModelId,
    isLoading: loadingDefault || loadingQuick || loadingTranslate,
    setDefaultModel: setDefaultModelId as (id: UniqueModelId) => Promise<void>,
    setQuickModel: setQuickModelId as (id: UniqueModelId) => Promise<void>,
    setTranslateModel: setTranslateModelId as (id: UniqueModelId) => Promise<void>
  }
}
