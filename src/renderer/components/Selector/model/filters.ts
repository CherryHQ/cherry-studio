import { MODEL_DISPLAY_TAGS, type ModelDisplayTag, modelMatchesDisplayTag } from '@renderer/components/Tags/Model'
import type { Model } from '@shared/data/types/model'
import { useCallback, useMemo, useState } from 'react'

export const MODEL_SELECTOR_TAGS = MODEL_DISPLAY_TAGS

export type ModelSelectorTag = ModelDisplayTag

const initialTagSelection = Object.fromEntries(MODEL_SELECTOR_TAGS.map((tag) => [tag, false])) as Record<
  ModelSelectorTag,
  boolean
>

/**
 * 标签筛选 hook，仅关注标签过滤逻辑
 */
export function useModelTagFilter() {
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
      return selectedTags.every((tag) => modelMatchesDisplayTag(model, tag))
    },
    [selectedTags]
  )

  return {
    tagSelection,
    selectedTags,
    tagFilter,
    toggleTag,
    resetTags
  }
}
