import { usePreference } from '@data/hooks/usePreference'
import { useModels } from '@renderer/hooks/useModels'
import { createUniqueModelId, isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { useCallback, useEffect, useMemo } from 'react'

function normalizePinnedModelId(value: string): UniqueModelId | null {
  if (!value) {
    return null
  }

  if (isUniqueModelId(value)) {
    return value
  }

  if (value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value) as { id?: unknown; provider?: unknown }
      if (typeof parsed.provider === 'string' && typeof parsed.id === 'string') {
        const providerId = parsed.provider.trim()
        const modelId = parsed.id.trim()
        if (providerId && modelId) {
          return createUniqueModelId(providerId, modelId)
        }
      }
    } catch {
      return null
    }
  }

  const separatorIndex = value.indexOf('/')
  if (separatorIndex <= 0) {
    return null
  }

  const providerId = value.slice(0, separatorIndex).trim()
  const modelId = value.slice(separatorIndex + 1).trim()
  if (!providerId || !modelId) {
    return null
  }

  return createUniqueModelId(providerId, modelId)
}

function dedupePinnedIds(ids: string[]): UniqueModelId[] {
  const normalizedIds: UniqueModelId[] = []
  const seen = new Set<string>()

  for (const id of ids) {
    const normalizedId = normalizePinnedModelId(id)
    if (!normalizedId || seen.has(normalizedId)) {
      continue
    }

    seen.add(normalizedId)
    normalizedIds.push(normalizedId)
  }

  return normalizedIds
}

export function usePinnedModelIds() {
  const [storedPinnedIds, setPinnedIds] = usePreference('app.model.pinned_ids')
  // 对齐 v1 usePinnedModels 行为：以"当前已启用的 models"为参照清理悬空 id。
  // Provider/Model 被禁用或删除，其 pin 都会随之失效 —— 与 v1 一致。
  const { models, isLoading: isModelsLoading } = useModels({ enabled: true })

  const pinnedIds = useMemo(() => dedupePinnedIds(storedPinnedIds), [storedPinnedIds])

  useEffect(() => {
    if (pinnedIds.length !== storedPinnedIds.length || pinnedIds.some((id, index) => id !== storedPinnedIds[index])) {
      void setPinnedIds(pinnedIds)
    }
  }, [pinnedIds, setPinnedIds, storedPinnedIds])

  // 对齐 v1 usePinnedModels 行为：当 models 加载完毕后，清理已不存在的 pin id。
  useEffect(() => {
    if (isModelsLoading || pinnedIds.length === 0) return
    const validModelIds = new Set(models.map((model) => model.id))
    const pruned = pinnedIds.filter((id) => validModelIds.has(id))
    if (pruned.length !== pinnedIds.length) {
      void setPinnedIds(pruned)
    }
  }, [isModelsLoading, models, pinnedIds, setPinnedIds])

  const togglePin = useCallback(
    async (uniqId: UniqueModelId) => {
      const nextPinnedIds = pinnedIds.includes(uniqId)
        ? pinnedIds.filter((id) => id !== uniqId)
        : [...pinnedIds.filter((id) => id !== uniqId), uniqId]

      await setPinnedIds(nextPinnedIds)
    },
    [pinnedIds, setPinnedIds]
  )

  return {
    pinnedIds,
    togglePin
  }
}
