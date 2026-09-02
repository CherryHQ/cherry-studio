import { ipcApi, useIpcOn } from '@renderer/ipc'
import {
  CHERRY_CLOUD_MODEL_FEATURE,
  type CherryCloudModelFeature,
  isManagedCherryCloudModel
} from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { useMemo } from 'react'
import useSWR from 'swr'

const CHERRY_CLOUD_AVAILABILITY_KEY = 'cherry-cloud/model-availability'
const CHERRY_CLOUD_AVAILABILITY_REFRESH_INTERVAL_MS = 60_000
const EMPTY_CHERRY_CLOUD_AVAILABILITY = {
  entitledModelIds: [],
  quotaExhaustedModelIds: [],
  featuresByModelId: {}
}

export type CherryCloudModelPredicate = (model: Model, provider?: Provider) => boolean
export type CherryCloudModelFeaturePredicate = (model: Model, feature: CherryCloudModelFeature) => boolean

export function useCherryCloudModelAvailability(): {
  isModelAvailableForFeature: CherryCloudModelFeaturePredicate
  isModelDisabled: CherryCloudModelPredicate
} {
  const { data: cloudAvailability, mutate } = useSWR(
    CHERRY_CLOUD_AVAILABILITY_KEY,
    () => ipcApi.request('cherry_cloud.models.sync'),
    {
      dedupingInterval: 5_000,
      refreshInterval: CHERRY_CLOUD_AVAILABILITY_REFRESH_INTERVAL_MS,
      revalidateOnReconnect: false,
      shouldRetryOnError: false
    }
  )

  useIpcOn('cherry_cloud.status_changed', (status) => {
    void mutate(EMPTY_CHERRY_CLOUD_AVAILABILITY, { revalidate: status.phase === 'signed-in' }).catch(() => undefined)
  })

  return useMemo(() => {
    const entitledModelIds = new Set(cloudAvailability?.entitledModelIds)
    const quotaExhaustedModelIds = new Set(cloudAvailability?.quotaExhaustedModelIds)
    return {
      isModelAvailableForFeature: (model: Model, feature: CherryCloudModelFeature) => {
        if (!isManagedCherryCloudModel(model.providerId)) return true
        if (!cloudAvailability) return feature === CHERRY_CLOUD_MODEL_FEATURE.AGENT
        return cloudAvailability.featuresByModelId[model.id]?.includes(feature) ?? false
      },
      isModelDisabled: (model: Model) =>
        isManagedCherryCloudModel(model.providerId) &&
        (!cloudAvailability || !entitledModelIds.has(model.id) || quotaExhaustedModelIds.has(model.id))
    }
  }, [cloudAvailability])
}
