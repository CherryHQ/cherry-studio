import type { ReasoningEffort } from '@cherrystudio/provider-registry'
import { deriveThinkingOptions, nearestThinkingOption } from '@shared/ai/reasoning'
import type { ReasoningEffortMappingOverrides, UserReasoningEffortMap } from '@shared/data/preference/preferenceTypes'
import type { Model } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'

export type { UserReasoningEffortMap }

export interface ReasoningEffortMappingContext {
  providerId: string
  modelId: string
  modelFamily?: string
  uniqueModelId?: string
}

const MAPPABLE_EFFORTS: readonly ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
  'auto'
]

export const REASONING_EFFORT_MAPPING_TIERS = MAPPABLE_EFFORTS

export function isMappableReasoningEffort(value: string): value is ReasoningEffort {
  return (MAPPABLE_EFFORTS as readonly string[]).includes(value)
}

/** Merge override layers; later layers win per key (most specific scope last). */
export function mergeUserReasoningEffortMaps(
  ...layers: Array<UserReasoningEffortMap | undefined>
): UserReasoningEffortMap {
  return layers.reduce<UserReasoningEffortMap>((acc, layer) => (layer ? { ...acc, ...layer } : acc), {})
}

/**
 * Resolve the effective user effort map for a provider/model using:
 * global → provider default → model family → model id → unique model id.
 */
export function resolveEffectiveUserEffortMap(
  overrides: ReasoningEffortMappingOverrides | undefined,
  context: ReasoningEffortMappingContext
): UserReasoningEffortMap {
  if (!overrides) return {}

  const providerScope = overrides.providers?.[context.providerId]
  return mergeUserReasoningEffortMaps(
    overrides.global,
    providerScope?.default,
    context.modelFamily ? providerScope?.families?.[context.modelFamily] : undefined,
    providerScope?.models?.[context.modelId],
    context.uniqueModelId ? providerScope?.models?.[context.uniqueModelId] : undefined
  )
}

export function hasCustomReasoningEffortMapping(
  overrides: ReasoningEffortMappingOverrides | undefined,
  context: ReasoningEffortMappingContext
): boolean {
  const map = resolveEffectiveUserEffortMap(overrides, context)
  return Object.keys(map).length > 0
}

/**
 * Apply a user-configured translation before model vocabulary projection.
 * Non-tier selections (`default` / `none`) are left unchanged.
 */
export function applyUserReasoningEffortTranslation<T extends string>(
  selection: T,
  userMap: UserReasoningEffortMap | undefined
): T {
  if (!userMap || selection === 'default') return selection
  if (!isMappableReasoningEffort(selection)) return selection
  const translated = userMap[selection]
  return (translated ?? selection) as T
}

/** Keep only targets the model declares in its reasoning vocabulary. */
/** Project a UI effort through user overrides and the model vocabulary (renderer preview). */
export function previewMappedReasoningEffort(
  selection: ReasoningEffortOption,
  model: Model,
  userMap: UserReasoningEffortMap | undefined
): ReasoningEffortOption {
  if (selection === 'default') return selection
  const translated = applyUserReasoningEffortTranslation(selection, userMap)
  const options = deriveThinkingOptions(model) ?? []
  return nearestThinkingOption(translated, options) ?? selection
}

export function sanitizeUserReasoningEffortMap(
  map: UserReasoningEffortMap,
  supportedEfforts: readonly ReasoningEffort[] | undefined
): UserReasoningEffortMap {
  if (!supportedEfforts?.length) return {}
  const supported = new Set(supportedEfforts)
  const sanitized: UserReasoningEffortMap = {}
  for (const [source, target] of Object.entries(map) as Array<[ReasoningEffort, ReasoningEffort]>) {
    if (!supported.has(target)) continue
    sanitized[source] = target
  }
  return sanitized
}
