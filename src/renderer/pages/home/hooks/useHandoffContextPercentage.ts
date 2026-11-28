import useSWR from 'swr'

import { ipcApi } from '@renderer/ipc'
import type { Model } from '@shared/data/types/model'

/** Estimate each selected model's active branch without choosing a generation destination. */
export function useHandoffContextPercentage({
  enabled,
  topicId,
  anchorId,
  fillsAnchor,
  candidates,
  revision
}: {
  enabled: boolean
  topicId: string
  anchorId?: string
  fillsAnchor: boolean
  candidates?: Model[]
  revision: unknown
}) {
  const models = [...new Map((candidates ?? []).map((model) => [model.id, model])).values()].filter(
    (model): model is Model & { contextWindow: number } =>
      typeof model.contextWindow === 'number' && Number.isFinite(model.contextWindow) && model.contextWindow > 0
  )
  const { data, mutate } = useSWR(
    enabled && anchorId && models.length > 0
      ? ([
          'handoff.branch.percentages',
          topicId,
          anchorId,
          fillsAnchor,
          models.map((model) => [model.id, model.contextWindow] as const),
          revision
        ] as const)
      : null,
    async ([, topicId, anchorId, fillsAnchor, selected]) => {
      const estimates = await Promise.allSettled(
        selected.map(async ([modelId, window]) => {
          const tokens = await ipcApi.request('ai.topic.estimate_context', { topicId, anchorId, modelId, fillsAnchor })
          return typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 0 ? (tokens / window) * 100 : null
        })
      )
      const percentages = estimates.flatMap((estimate) =>
        estimate.status === 'fulfilled' && estimate.value !== null ? [estimate.value] : []
      )
      return percentages.length ? Math.max(...percentages) : null
    },
    { shouldRetryOnError: false, keepPreviousData: false }
  )
  return { percentage: enabled ? (data ?? null) : null, refresh: mutate }
}
