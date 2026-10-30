import { useMemo } from 'react'

import { useCherryCloudModelAvailability } from '@renderer/hooks/useCherryCloudModelAvailability'
import { useCherryCloudPlans } from '@renderer/hooks/useCherryCloudPlans'
import { getQuotaRecoveryTime } from '@renderer/utils/cherryCloudQuota'
import { isManagedCherryCloudModel } from '@shared/data/presets/cherryai'
import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import type { CherryCloudAccountPlans } from '@shared/ipc/schemas/cherryCloud'

export interface CherryCloudQuotaExhaustion {
  isFreeModel: boolean
  isSubscribed: boolean
  /** ISO time the model becomes usable again, when every blocking window reports one. */
  recoversAt?: string
}

// A pool serves the model again once all of its exhausted windows recover; any one such pool suffices.
function getRecoveryTime(plans: CherryCloudAccountPlans | undefined, cloudModelId: string): string | undefined {
  const poolRecoveries = (plans?.entitlements ?? [])
    .filter((entitlement) => entitlement.state === 'active')
    .flatMap((entitlement) => entitlement.quota_pools)
    .filter((pool) => pool.model_ids.includes(cloudModelId))
    .flatMap((pool) => {
      const exhausted = pool.windows.filter((window) => window.remaining_units === 0)
      const times = exhausted.map((window) => {
        const recoversAt = getQuotaRecoveryTime(window)
        return recoversAt ? Date.parse(recoversAt) : NaN
      })
      return exhausted.length > 0 && times.every(Number.isFinite) ? [Math.max(...times)] : []
    })
  return poolRecoveries.length > 0 ? new Date(Math.min(...poolRecoveries)).toISOString() : undefined
}

/** Whether the composer's Cherry Cloud model is out of quota, and what the user can do about it. */
export function useCherryCloudQuotaExhaustion(model: Model | undefined): CherryCloudQuotaExhaustion | null {
  const isCloudModel = Boolean(model && isManagedCherryCloudModel(model.providerId))
  const { isModelFree, isModelUnavailable } = useCherryCloudModelAvailability(isCloudModel)
  const exhausted = Boolean(model && isCloudModel && isModelUnavailable(model))
  const { plansQuery, activePaid } = useCherryCloudPlans(exhausted)

  return useMemo(() => {
    if (!model || !exhausted) return null
    return {
      isFreeModel: isModelFree(model),
      isSubscribed: Boolean(activePaid),
      recoversAt: getRecoveryTime(plansQuery.data, parseUniqueModelId(model.id).modelId)
    }
  }, [activePaid, exhausted, isModelFree, model, plansQuery.data])
}
