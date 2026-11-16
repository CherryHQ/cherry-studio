import { useMemo } from 'react'

import { useCherryCloudModelAvailability } from '@renderer/hooks/useCherryCloudModelAvailability'
import { useCherryCloudPlans } from '@renderer/hooks/useCherryCloudPlans'
import { getQuotaRecoveryTime } from '@renderer/utils/cherryCloudQuota'
import { isManagedCherryCloudModel } from '@shared/data/presets/cherryai'
import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import type { CherryCloudAccountPlans } from '@shared/ipc/schemas/cherryCloud'

export type CherryCloudQuotaExhaustion = {
  isFreeModel: boolean
  /** Undefined while the current account's plans are unknown or stale. */
  isSubscribed: boolean | undefined
} & (
  | { reason: 'unknown'; state: 'loading' | 'error' | 'stale' }
  | { reason: 'quota_exhausted'; recoversAt?: string }
  | { reason: 'sign_in_required' | 'subscription_required' | 'not_in_plan' }
)

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

/** Whether the composer's Cherry Cloud model cannot be used right now, and what the user can do about it. */
export function useCherryCloudQuotaExhaustion(
  model: Model | undefined,
  includeAgentOnlyModels = false
): CherryCloudQuotaExhaustion | null {
  const isCloudModel = Boolean(model && isManagedCherryCloudModel(model.providerId))
  const { isModelFree, isModelLocked, isModelUnavailable, availabilityFreshness, availabilityError } =
    useCherryCloudModelAvailability(isCloudModel)
  const locked = Boolean(model && isCloudModel && isModelLocked(model, includeAgentOnlyModels))
  const exhausted = Boolean(model && isCloudModel && !locked && isModelUnavailable(model))
  const { session, plansQuery, activePaid, upcomingPaid, isPlansReady, plansFreshness } =
    useCherryCloudPlans(isCloudModel)
  const phase = session.status?.phase

  return useMemo<CherryCloudQuotaExhaustion | null>(() => {
    if (!model || !isCloudModel) return null
    const base = {
      isFreeModel: isModelFree(model),
      isSubscribed: isPlansReady ? Boolean(activePaid || upcomingPaid) : undefined
    }
    if (availabilityFreshness !== 'fresh')
      return {
        ...base,
        reason: 'unknown',
        state: availabilityError ? 'error' : availabilityFreshness === 'stale' ? 'stale' : 'loading'
      }
    if (!(locked || exhausted)) return null
    if (exhausted) {
      return {
        ...base,
        reason: 'quota_exhausted',
        recoversAt: getRecoveryTime(isPlansReady ? plansQuery.data : undefined, parseUniqueModelId(model.id).modelId)
      }
    }
    if (phase === 'signed-out') return { ...base, reason: 'sign_in_required' }
    if (phase !== 'signed-in' || !isPlansReady)
      return {
        ...base,
        reason: 'unknown',
        state:
          session.loadState === 'error' || plansQuery.error ? 'error' : plansFreshness === 'stale' ? 'stale' : 'loading'
      }
    return { ...base, reason: !activePaid && !upcomingPaid ? 'subscription_required' : 'not_in_plan' }
  }, [
    activePaid,
    upcomingPaid,
    exhausted,
    isCloudModel,
    isModelFree,
    locked,
    model,
    phase,
    plansQuery.data,
    plansQuery.error,
    isPlansReady,
    plansFreshness,
    availabilityFreshness,
    availabilityError,
    session.loadState
  ])
}
