import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { ipcApi, useIpcOn } from '@renderer/ipc'
import { isManagedCherryCloudModel } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'
import type { CherryCloudModelSyncResult } from '@shared/ipc/schemas/cherryCloud'

const CHERRY_CLOUD_AVAILABILITY_KEY = 'cherry-cloud/model-availability'
const CHERRY_CLOUD_AVAILABILITY_REFRESH_INTERVAL_MS = 60_000
const EMPTY_CHERRY_CLOUD_AVAILABILITY: CherryCloudModelSyncResult = {
  entitledModelIds: [],
  freeModelIds: [],
  availableModelIds: { agent: [], general: [] },
  quotaExhaustedModelIds: []
}

/**
 * Cherry Cloud's server-declared model availability, expressed in model-selector terms so no other
 * module needs to know about Cloud features. Agent pickers (`includeAgentOnlyModels`) follow the
 * server's `agent` list, every other picker its `general` list.
 */
export function useCherryCloudModelAvailability(enabled = true) {
  const { t } = useTranslation()
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
    const freeModelIds = new Set(cloudAvailability?.freeModelIds)
    const quotaExhaustedModelIds = new Set(cloudAvailability?.quotaExhaustedModelIds)
    const agentModelIds = new Set(cloudAvailability?.availableModelIds.agent)
    const generalModelIds = new Set(cloudAvailability?.availableModelIds.general)

    return {
      /** Hidden until the first snapshot arrives, then hidden wherever the server does not enable it. */
      isModelHidden: (model: Model, includeAgentOnlyModels: boolean) =>
        isManagedCherryCloudModel(model.providerId) &&
        !(includeAgentOnlyModels ? agentModelIds : generalModelIds).has(model.id),
      isModelUnavailable: (model: Model) =>
        isManagedCherryCloudModel(model.providerId) && quotaExhaustedModelIds.has(model.id),
      getModelDescription: (model: Model): string | undefined => {
        if (!isManagedCherryCloudModel(model.providerId)) return undefined
        const isFree = freeModelIds.has(model.id)
        if (quotaExhaustedModelIds.has(model.id)) {
          return t(isFree ? 'models.detail.free_quota_exhausted' : 'models.detail.quota_exhausted')
        }
        if (!isFree) return undefined
        return t(
          generalModelIds.has(model.id)
            ? 'models.detail.limited_time_free'
            : 'models.detail.limited_time_free_agent_only'
        )
      }
    }
  }, [cloudAvailability, t])
}
