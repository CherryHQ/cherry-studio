// Health-first ordering for the retry chain: a model whose last probe failed is tried last and an
// unprobed one stays mid-pack, so a chain configured once keeps working as providers come and go.

import type { ModelHealthMemory, RetryFallbackModelId } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import { getModelQualityScore } from '@shared/utils/modelQuality'

const HEALTH_RANK = { ok: 0, unknown: 1, failed: 2 } as const

function healthRank(id: RetryFallbackModelId, health: ModelHealthMemory): number {
  const entry = health[id]
  if (!entry) return HEALTH_RANK.unknown
  return entry.ok ? HEALTH_RANK.ok : HEALTH_RANK.failed
}

// Malformed ids reach here before buildFallbackModels validates them; scoring the raw string keeps
// ordering total instead of throwing away the whole retry policy.
function qualityOf(id: RetryFallbackModelId): number {
  return getModelQualityScore(isUniqueModelId(id) ? parseUniqueModelId(id).modelId : id)
}

/**
 * Sorts fallbacks by last probed health, then by quality score. Nothing is dropped — a failed probe
 * only loses priority, because the provider may have recovered since.
 */
export function orderFallbackModels(
  ids: readonly RetryFallbackModelId[],
  health: ModelHealthMemory
): RetryFallbackModelId[] {
  return [...ids].sort((a, b) => healthRank(a, health) - healthRank(b, health) || qualityOf(b) - qualityOf(a))
}
