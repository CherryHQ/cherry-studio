import { useMemo } from 'react'

import { useCherryCloudModelAvailability } from '@renderer/hooks/useCherryCloudModelAvailability'
import { useCherryCloudPlans } from '@renderer/hooks/useCherryCloudPlans'
import { isManagedCherryCloudModel } from '@shared/data/presets/cherryai'
import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import type { CherryCloudAccountPlans } from '@shared/ipc/schemas/cherryCloud'

export interface CherryCloudQuotaExhaustion {
  /** Out of quota, or locked: signed out, not subscribed, or not part of the subscribed plan. */
  reason: 'quota_exhausted' | 'sign_in_required' | 'subscription_required' | 'not_in_plan'
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
      const times = exhausted.map((window) => (window.next_recovery_at ? Date.parse(window.next_recovery_at) : NaN))
      return exhausted.length > 0 && times.every(Number.isFinite) ? [Math.max(...times)] : []
    })
  return poolRecoveries.length > 0 ? new Date(Math.min(...poolRecoveries)).toISOString() : undefined
}

/** Whether the composer's Cherry Cloud model cannot be used right now, and what the user can do about it. */
export function useCherryCloudQuotaExhaustion(
  model: Model | undefined,
  includeAgentOnlyModels = false
): CherryCloudQuotaExhaustion | null {
  const isCloudModel = Boolean(model && isManagedCherryCloudModel(model.providerId))
  const { isModelFree, isModelLocked, isModelUnavailable } = useCherryCloudModelAvailability(isCloudModel)
  const locked = Boolean(model && isCloudModel && isModelLocked(model, includeAgentOnlyModels))
  const exhausted = Boolean(model && isCloudModel && !locked && isModelUnavailable(model))
  const { session, plansQuery, activePaid } = useCherryCloudPlans(locked || exhausted)
  const phase = session.status?.phase

  return useMemo<CherryCloudQuotaExhaustion | null>(() => {
    if (!model || !(locked || exhausted)) return null
    const base = { isFreeModel: isModelFree(model), isSubscribed: Boolean(activePaid) }
    if (exhausted) {
      return {
        ...base,
        reason: 'quota_exhausted',
        recoversAt: getRecoveryTime(plansQuery.data, parseUniqueModelId(model.id).modelId)
      }
    }
    if (phase !== 'signed-in') return { ...base, reason: 'sign_in_required' }
    // Until the plans load, offer no subscription that a paying account would not need.
    return { ...base, reason: plansQuery.data && !activePaid ? 'subscription_required' : 'not_in_plan' }
  }, [activePaid, exhausted, isModelFree, locked, model, phase, plansQuery.data])
}
