import { ipcApi, useIpcOn } from '@renderer/ipc'
import { isManagedCherryCloudModel } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { CherryCloudModelFeature, CherryCloudModelSyncResult } from '@shared/ipc/schemas/cherryCloud'
import { useCallback, useMemo } from 'react'
import useSWR from 'swr'

const CHERRY_CLOUD_AVAILABILITY_KEY = 'cherry-cloud/model-availability'
const CHERRY_CLOUD_AVAILABILITY_REFRESH_INTERVAL_MS = 60_000
const CHERRY_CLOUD_MODEL_FEATURES = ['agent', 'chat', 'translate'] as const satisfies readonly CherryCloudModelFeature[]
const EMPTY_CHERRY_CLOUD_AVAILABILITY: CherryCloudModelSyncResult = {
  entitledModelIds: [],
  freeModelIds: [],
  availableModelIdsByFeature: { agent: [], chat: [], translate: [] },
  quotaExhaustedModelIds: []
}

type ModelPredicate = (model: Model, provider?: Provider) => boolean

export type CherryCloudFreeQuotaStatus = 'available' | 'exhausted'

export function useCherryCloudModelAvailability(enabled = true) {
  const { data: cloudAvailability, mutate } = useSWR(
    enabled ? CHERRY_CLOUD_AVAILABILITY_KEY : null,
    () => ipcApi.request('cherry_cloud.models.sync'),
    {
      dedupingInterval: 5_000,
      refreshInterval: CHERRY_CLOUD_AVAILABILITY_REFRESH_INTERVAL_MS,
      revalidateOnReconnect: false,
      shouldRetryOnError: false
    }
  )

  useIpcOn('cherry_cloud.status_changed', () => {
    if (!enabled) return
    void mutate(EMPTY_CHERRY_CLOUD_AVAILABILITY, { revalidate: true }).catch(() => undefined)
  })

  return useMemo(() => {
    const entitledModelIds = new Set(cloudAvailability?.entitledModelIds)
    const freeModelIds = new Set(cloudAvailability?.freeModelIds)
    const quotaExhaustedModelIds = new Set(cloudAvailability?.quotaExhaustedModelIds)
    const availableModelIdsByFeature = {
      agent: new Set(cloudAvailability?.availableModelIdsByFeature?.agent),
      chat: new Set(cloudAvailability?.availableModelIdsByFeature?.chat),
      translate: new Set(cloudAvailability?.availableModelIdsByFeature?.translate)
    }

    const isModelAvailableForFeature = (model: Model, feature: CherryCloudModelFeature) =>
      !isManagedCherryCloudModel(model.providerId) ||
      Boolean(cloudAvailability && availableModelIdsByFeature[feature].has(model.id))

    return {
      getModelFreeQuotaStatus: (model: Model): CherryCloudFreeQuotaStatus | undefined => {
        if (
          !isManagedCherryCloudModel(model.providerId) ||
          !cloudAvailability ||
          !entitledModelIds.has(model.id) ||
          !freeModelIds.has(model.id)
        ) {
          return undefined
        }
        return quotaExhaustedModelIds.has(model.id) ? 'exhausted' : 'available'
      },
      isModelQuotaExhausted: (model: Model) =>
        isManagedCherryCloudModel(model.providerId) &&
        entitledModelIds.has(model.id) &&
        quotaExhaustedModelIds.has(model.id),
      isModelAvailableForFeature,
      isModelDisabledForFeature: (model: Model, feature: CherryCloudModelFeature) =>
        isManagedCherryCloudModel(model.providerId) &&
        (!isModelAvailableForFeature(model, feature) || quotaExhaustedModelIds.has(model.id)),
      isModelExclusiveToFeature: (model: Model, feature: CherryCloudModelFeature) =>
        isManagedCherryCloudModel(model.providerId) &&
        Boolean(cloudAvailability && availableModelIdsByFeature[feature].has(model.id)) &&
        CHERRY_CLOUD_MODEL_FEATURES.every(
          (candidate) => candidate === feature || !availableModelIdsByFeature[candidate].has(model.id)
        )
    }
  }, [cloudAvailability])
}

export function useCherryCloudModelFilter(
  feature: CherryCloudModelFeature,
  filter?: ModelPredicate,
  enabled = true
): ModelPredicate {
  const { isModelAvailableForFeature } = useCherryCloudModelAvailability(enabled)

  return useCallback(
    (model: Model, provider?: Provider) =>
      isModelAvailableForFeature(model, feature) && (filter?.(model, provider) ?? true),
    [feature, filter, isModelAvailableForFeature]
  )
}
