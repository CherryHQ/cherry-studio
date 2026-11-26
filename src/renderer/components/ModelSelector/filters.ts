import { useCallback, useMemo, useState } from 'react'

import { MODEL_DISPLAY_TAGS, type ModelDisplayTag, getModelDisplayTags } from '@renderer/components/tags/Model'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

export const MODEL_SELECTOR_TAGS = MODEL_DISPLAY_TAGS

export type ModelSelectorTag = ModelDisplayTag

const initialTagSelection = Object.fromEntries(MODEL_SELECTOR_TAGS.map((tag) => [tag, false])) as Record<
  ModelSelectorTag,
  boolean
>

/**
 * 标签筛选 hook，仅关注标签过滤逻辑
 */
export function useModelTagFilter(
  getTags: (model: Model, provider?: Provider) => readonly ModelSelectorTag[] = (model, provider) =>
    getModelDisplayTags(model, undefined, provider)
) {
  const [tagSelection, setTagSelection] = useState<Record<ModelSelectorTag, boolean>>(initialTagSelection)

  const selectedTags = useMemo(() => MODEL_SELECTOR_TAGS.filter((tag) => tagSelection[tag]), [tagSelection])

  const toggleTag = useCallback((tag: ModelSelectorTag) => {
    setTagSelection((prev) => ({ ...prev, [tag]: !prev[tag] }))
  }, [])

  const resetTags = useCallback(() => {
    setTagSelection(initialTagSelection)
  }, [])

  const tagFilter = useCallback(
    (model: Model, provider?: Provider) => {
      if (selectedTags.length === 0) return true
      const tags = getTags(model, provider)
      return selectedTags.every((tag) => tags.includes(tag))
    },
    [getTags, selectedTags]
  )

  return {
    tagSelection,
    selectedTags,
    tagFilter,
    toggleTag,
    resetTags
  }
}
