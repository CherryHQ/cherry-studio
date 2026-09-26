// Health-first ordering for the retry chain: a model whose last probe failed is tried last and an
// unprobed one stays mid-pack, so a chain configured once keeps working as providers come and go.
// Tier (free/trial/paid) breaks ties within a health rank, so an auto fallback doesn't quietly
// land on a paid key while a free one on another candidate was still usable.

import { providerService } from '@main/data/services/ProviderService'
import type { ModelHealthMemory, RetryFallbackModelId } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { ApiKeyTier } from '@shared/data/types/provider'
import { freshModelHealth } from '@shared/utils/modelHealth'
import { getModelQualityScore } from '@shared/utils/modelQuality'

const HEALTH_RANK = { ok: 0, unknown: 1, failed: 2 } as const

function healthRank(id: RetryFallbackModelId, health: ModelHealthMemory): number {
  const entry = freshModelHealth(health[id])
  if (!entry) return HEALTH_RANK.unknown
  return entry.ok ? HEALTH_RANK.ok : HEALTH_RANK.failed
}

const TIER_RANK: Record<ApiKeyTier, number> = { free: 0, trial: 1, paid: 2 }

/**
 * Cheapest tier reachable through one of this provider's enabled keys — one free key among several
 * paid ones still means the cheap path is available. No enabled key, or a lookup failure (deleted
 * provider), ranks as `paid`: the most conservative slot, never promoted above a real free key.
 */
function providerTierRank(providerId: string): number {
  try {
    const keys = providerService.getApiKeys(providerId, { enabled: true })
    if (keys.length === 0) return TIER_RANK.paid
    return Math.min(...keys.map((key) => TIER_RANK[key.tier ?? 'free']))
  } catch {
    return TIER_RANK.paid
  }
}

// Malformed ids reach here before buildFallbackModels validates them; scoring the raw string keeps
// ordering total instead of throwing away the whole retry policy.
function qualityOf(id: RetryFallbackModelId): number {
  return getModelQualityScore(isUniqueModelId(id) ? parseUniqueModelId(id).modelId : id)
}

/**
 * Sorts fallbacks by last probed health, then by the cheapest tier still reachable on that
 * provider, then by quality score. Nothing is dropped — a failed probe or a paid-only provider only
 * loses priority, because the provider may have recovered, or a free key may get added, later.
 *
 * @param escalationEnabled When true, prioritizes cheap tiers (free > trial > paid) over health,
 *   so simple tasks get cheap models first and only escalate if they fail.
 */
export function orderFallbackModels(
  ids: readonly RetryFallbackModelId[],
  health: ModelHealthMemory,
  escalationEnabled: boolean = false
): RetryFallbackModelId[] {
  const tierRanks = new Map<string, number>()
  const tierRankOf = (id: RetryFallbackModelId): number => {
    if (!isUniqueModelId(id)) return TIER_RANK.paid
    const { providerId } = parseUniqueModelId(id)
    let rank = tierRanks.get(providerId)
    if (rank === undefined) {
      rank = providerTierRank(providerId)
      tierRanks.set(providerId, rank)
    }
    return rank
  }

  return [...ids].sort((a, b) => {
    if (escalationEnabled) {
      // Escalation mode: prefer cheap tiers first (free < trial < paid),
      // then quality for same tier
      return tierRankOf(a) - tierRankOf(b) || qualityOf(b) - qualityOf(a)
    }
    // Normal mode: health first, then tier, then quality
    return healthRank(a, health) - healthRank(b, health) || tierRankOf(a) - tierRankOf(b) || qualityOf(b) - qualityOf(a)
  })
}
