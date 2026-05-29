import { type Model, MODEL_CAPABILITY, type ModelTag } from '@shared/data/types/model'
import { useCallback, useMemo, useState } from 'react'

type ModelPredict = (m: Model) => boolean

export const MODEL_SELECTOR_TAGS = [
  MODEL_CAPABILITY.IMAGE_RECOGNITION,
  MODEL_CAPABILITY.EMBEDDING,
  MODEL_CAPABILITY.REASONING,
  MODEL_CAPABILITY.FUNCTION_CALL,
  MODEL_CAPABILITY.WEB_SEARCH,
  MODEL_CAPABILITY.RERANK,
  'free'
] as const satisfies readonly ModelTag[]

export type ModelSelectorTag = (typeof MODEL_SELECTOR_TAGS)[number]

const initialTagSelection = Object.fromEntries(MODEL_SELECTOR_TAGS.map((tag) => [tag, false])) as Record<
  ModelSelectorTag,
  boolean
>

const capabilityTagPredicates: Record<Exclude<ModelSelectorTag, 'free'>, ModelPredict> = {
  [MODEL_CAPABILITY.IMAGE_RECOGNITION]: (model) => model.capabilities.includes(MODEL_CAPABILITY.IMAGE_RECOGNITION),
  [MODEL_CAPABILITY.EMBEDDING]: (model) => model.capabilities.includes(MODEL_CAPABILITY.EMBEDDING),
  [MODEL_CAPABILITY.REASONING]: (model) => model.capabilities.includes(MODEL_CAPABILITY.REASONING),
  [MODEL_CAPABILITY.FUNCTION_CALL]: (model) => model.capabilities.includes(MODEL_CAPABILITY.FUNCTION_CALL),
  [MODEL_CAPABILITY.WEB_SEARCH]: (model) => model.capabilities.includes(MODEL_CAPABILITY.WEB_SEARCH),
  [MODEL_CAPABILITY.RERANK]: (model) => model.capabilities.includes(MODEL_CAPABILITY.RERANK)
}

function isFreeModel(model: Model) {
  if (model.providerId === 'cherryai') {
    return true
  }

  return `${model.id} ${model.name} ${model.apiModelId ?? ''}`.toLowerCase().includes('free')
}

export function matchesModelTag(model: Model, tag: ModelSelectorTag) {
  return (tag === 'free' ? isFreeModel : capabilityTagPredicates[tag])(model)
}

/**
 * 标签筛选 hook，仅关注标签过滤逻辑
 */
export function useModelTagFilter() {
  const filterConfig: Record<ModelSelectorTag, ModelPredict> = useMemo(() => {
    const entries = MODEL_SELECTOR_TAGS.map((tag) => [tag, (model: Model) => matchesModelTag(model, tag)]) as [
      ModelSelectorTag,
      ModelPredict
    ][]

    return Object.fromEntries(entries) as Record<ModelSelectorTag, ModelPredict>
  }, [])

  const [tagSelection, setTagSelection] = useState<Record<ModelSelectorTag, boolean>>(initialTagSelection)

  const selectedTags = useMemo(() => MODEL_SELECTOR_TAGS.filter((tag) => tagSelection[tag]), [tagSelection])

  const toggleTag = useCallback((tag: ModelSelectorTag) => {
    setTagSelection((prev) => ({ ...prev, [tag]: !prev[tag] }))
  }, [])

  const resetTags = useCallback(() => {
    setTagSelection(initialTagSelection)
  }, [])

  const tagFilter = useCallback(
    (model: Model) => {
      if (selectedTags.length === 0) return true
      return selectedTags.map((tag) => filterConfig[tag]).every((predict) => predict(model))
    },
    [filterConfig, selectedTags]
  )

  return {
    tagSelection,
    selectedTags,
    tagFilter,
    toggleTag,
    resetTags
  }
}
