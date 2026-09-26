import type { ApiKeyLimitMap, ModelHealthMemory } from '@shared/data/preference/preferenceTypes'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { apiKeyLimitId, apiKeyModelLimitId, type KeyUsageCounts, usageAgainstLimit } from '@shared/utils/apiKeyLimit'
import { freshModelHealth } from '@shared/utils/modelHealth'
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
 * Requests left on each usable key for this provider+model, in key order.
 *
 * A key with no ceiling declared contributes `undefined` — unknown, not unlimited and not zero.
 * Resolution order (model-scoped ceiling, then the key's own) mirrors the main-process
 * `apiKeyQuota.ts`, so the picker and the router never disagree about a key.
 */
function remainingPerKey(
  provider: Provider,
  modelId: UniqueModelId,
  limits: ApiKeyLimitMap | null | undefined,
  usageCounts: KeyUsageCounts | undefined
): Array<number | undefined> {
  if (!limits || !usageCounts) return []
  return provider.apiKeys
    .filter((key) => key.isEnabled)
    .map((key) => {
      const modelLimit = limits[apiKeyModelLimitId(provider.id, key.id, modelId)]
      const limit = modelLimit ?? limits[apiKeyLimitId(provider.id, key.id)]
      if (!limit) return undefined
      // A model-scoped ceiling is spent only by that model; a key-scoped one by all of them.
      const spent = usageAgainstLimit(usageCounts, key.id, modelLimit ? modelId : undefined)
      return spent === undefined ? undefined : Math.max(0, limit.limit - spent)
    })
}

/**
 * Check if every usable key for this provider+model is over quota.
 * Uses the same resolution logic as the main-process `apiKeyQuota.ts`.
 */
export function isQuotaExhausted(
  provider: Provider,
  modelId: UniqueModelId,
  limits: ApiKeyLimitMap | null | undefined,
  usageCounts: KeyUsageCounts | undefined
): boolean {
  const remaining = remainingPerKey(provider, modelId, limits, usageCounts)
  if (remaining.length === 0) return false
  // A key whose ceiling is unknown might well answer, so it keeps the model out of "exhausted".
  return remaining.every((left) => left === 0)
}

/**
 * Requests left across this provider's keys for one model, or `undefined` when no key declares a
 * ceiling — which is the common case and must read as "unknown", never as "none left".
 *
 * This is what lets one model name be compared across the providers that serve it: search
 * "deepseek" and each row says how much room it actually has, instead of the user having to
 * remember which account still had some.
 */
export function getRemainingQuota(
  provider: Provider,
  modelId: UniqueModelId,
  limits: ApiKeyLimitMap | null | undefined,
  usageCounts: KeyUsageCounts | undefined
): number | undefined {
  const known = remainingPerKey(provider, modelId, limits, usageCounts).filter(
    (left): left is number => left !== undefined
  )
  if (known.length === 0) return undefined
  return known.reduce((total, left) => total + left, 0)
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
  if (freshModelHealth(health?.[model.id])?.ok === false) return 'unhealthy'
  if (quotaExhaustedIds?.has(model.id)) return 'quota_exhausted'
  return undefined
}

/** Sort key placing usable models first; passive ones trail, least-broken first. */
export function passiveSortRank(reason: ModelPassiveReason | undefined): number {
  return reason ? PASSIVE_REASON_RANK[reason] : 0
}
