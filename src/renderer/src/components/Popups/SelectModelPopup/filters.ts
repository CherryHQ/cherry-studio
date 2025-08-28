import {
  isEmbeddingModel,
  isFunctionCallingModel,
  isReasoningModel,
  isRerankModel,
  isVisionModel,
  isWebSearchModel
} from '@renderer/config/models'
import { Model, ModelTag } from '@renderer/types'
import { isFreeModel } from '@renderer/utils/model'
import { useCallback, useMemo, useState } from 'react'

type ModelPredict = (m: Model) => boolean

/**
 * 标签筛选 hook，仅关注标签过滤逻辑
 */
export function useModelTagFilter() {
  const filterConfig: Record<ModelTag, ModelPredict> = useMemo(
    () => ({
      vision: isVisionModel,
      embedding: isEmbeddingModel,
      reasoning: isReasoningModel,
      function_calling: isFunctionCallingModel,
      web_search: isWebSearchModel,
      rerank: isRerankModel,
      free: isFreeModel
    }),
    []
  )

  const [tagSelection, setTagSelection] = useState<Record<ModelTag, boolean>>(() => {
    const initial: Record<ModelTag, boolean> = {
      vision: false,
      embedding: false,
      reasoning: false,
      function_calling: false,
      web_search: false,
      rerank: false,
      free: false
    }
    return initial
  })

  // 已选中的标签
  const selectedTags = useMemo(
    () =>
      Object.entries(tagSelection)
        .filter(([, state]) => state)
        .map(([tag]) => tag as ModelTag),
    [tagSelection]
  )

  // 切换标签
  const toggleTag = useCallback((tag: ModelTag) => {
    setTagSelection((prev) => ({ ...prev, [tag]: !prev[tag] }))
  }, [])

  // 重置标签
  const resetTags = useCallback(() => {
    setTagSelection({
      vision: false,
      embedding: false,
      reasoning: false,
      function_calling: false,
      web_search: false,
      rerank: false,
      free: false
    })
  }, [])

  // 根据标签过滤模型
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
