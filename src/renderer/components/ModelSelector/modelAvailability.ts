import type { ApiKeyLimitMap, ModelHealthMemory } from '@shared/data/preference/preferenceTypes'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { apiKeyLimitId, apiKeyModelLimitId } from '@shared/utils/apiKeyLimit'
import { isCherryAIProvider, isLoginBasedProvider } from '@shared/utils/provider'

/**
 * Why a model is shown but demoted. Ordered by how actionable it is: `unavailable` cannot be fixed
 * from the app at all, `disabled` is the user's own choice, the rest describe a broken setup.
 */
export type ModelPassiveReason = 'unavailable' | 'disabled' | 'no_credential' | 'unhealthy' | 'quota_exhausted'

const PASSIVE_REASON_RANK: Record<ModelPassiveReason, number> = {
  unhealthy: 1,
  quota_exhausted: 2,
  no_credential: 3,
  disabled: 4,
  unavailable: 5
}

function hasUsableCredential(provider: Provider): boolean {
  if (provider.authOptional === true) return true
  // OAuth / external-CLI providers carry no app-side key, so an empty key list says nothing.
  if (isLoginBasedProvider(provider)) return true
  return provider.apiKeys.some((key) => key.isEnabled)
}

/**
 * Check if every usable key for this provider+model is over quota.
 * Uses the same resolution logic as the main-process `apiKeyQuota.ts`.
 */
export function isQuotaExhausted(
  provider: Provider,
  modelId: string,
  limits: ApiKeyLimitMap | null | undefined,
  usageCounts: ReadonlyMap<string, number> | undefined
): boolean {
  if (!limits || !usageCounts) return false
  const usableKeys = provider.apiKeys.filter((k) => k.isEnabled)
  if (usableKeys.length === 0) return false

  return usableKeys.every((key) => {
    const modelLimit = limits[apiKeyModelLimitId(provider.id, key.id, modelId)]
    const keyLimit = limits[apiKeyLimitId(provider.id, key.id)]
    const limit = modelLimit ?? keyLimit
    if (!limit) return false
    const used = usageCounts.get(key.id) ?? 0
    return used >= limit.limit
  })
}

export function getModelPassiveReason(
  model: Model,
  provider: Provider,
  health: ModelHealthMemory | undefined,
  quotaExhaustedIds?: ReadonlySet<string>
): ModelPassiveReason | undefined {
  // Managed Cherry providers sign requests with a build-time secret that only official builds carry,
  // and neither the provider nor its default model can be disabled — marking is the only option.
  if (isCherryAIProvider(provider)) return 'unavailable'
  if (!model.isEnabled) return 'disabled'
  if (!hasUsableCredential(provider)) return 'no_credential'
  if (health?.[model.id]?.ok === false) return 'unhealthy'
  if (quotaExhaustedIds?.has(model.id)) return 'quota_exhausted'
  return undefined
}

/** Sort key placing usable models first; passive ones trail, least-broken first. */
export function passiveSortRank(reason: ModelPassiveReason | undefined): number {
  return reason ? PASSIVE_REASON_RANK[reason] : 0
}
