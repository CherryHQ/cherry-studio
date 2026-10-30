import type { ReasoningEffort } from '@cherrystudio/provider-registry'

import type { ReasoningEffortMappingOverrides, UserReasoningEffortMap } from './preferenceTypes'

/** Scope bucket a mapping entry lives in: the global fallback or one provider's default map. */
export type ReasoningEffortMappingScope = 'global' | 'provider'

/**
 * One atomic entry update: set `source → target`, or clear the entry when
 * `target` is null/undefined (undefined does not survive structured clone over
 * IPC, hence the nullable union).
 */
export type ReasoningEffortMappingEntryUpdate =
  | { scope: 'global'; source: ReasoningEffort; target?: ReasoningEffort | null }
  | { scope: 'provider'; providerId: string; source: ReasoningEffort; target?: ReasoningEffort | null }

export function readReasoningEffortScopeMap(
  overrides: ReasoningEffortMappingOverrides,
  scope: ReasoningEffortMappingScope,
  providerId?: string
): UserReasoningEffortMap {
  if (scope === 'global') return overrides.global ?? {}
  if (!providerId) return {}
  return overrides.providers?.[providerId]?.default ?? {}
}

export function writeReasoningEffortScopeMap(
  overrides: ReasoningEffortMappingOverrides,
  scope: ReasoningEffortMappingScope,
  providerId: string | undefined,
  map: UserReasoningEffortMap
): ReasoningEffortMappingOverrides {
  const cleaned = Object.fromEntries(
    Object.entries(map).filter(([, target]) => target !== undefined)
  ) as UserReasoningEffortMap

  if (scope === 'global') {
    return { ...overrides, global: Object.keys(cleaned).length > 0 ? cleaned : undefined }
  }
  if (!providerId) return overrides

  const providerScope = overrides.providers?.[providerId] ?? {}
  const nextProviderScope = {
    ...providerScope,
    default: Object.keys(cleaned).length > 0 ? cleaned : undefined
  }
  const providers = { ...overrides.providers, [providerId]: nextProviderScope }
  return { ...overrides, providers }
}

/**
 * Apply a single entry update to a whole overrides object, leaving every other
 * scope and entry untouched. This is the unit of work the main process applies
 * atomically per renderer request, so independent edits from detached Settings
 * windows merge instead of the last whole-object snapshot winning.
 */
export function applyReasoningEffortMappingEntry(
  overrides: ReasoningEffortMappingOverrides,
  update: ReasoningEffortMappingEntryUpdate
): ReasoningEffortMappingOverrides {
  const providerId = update.scope === 'provider' ? update.providerId : undefined
  const nextMap = { ...readReasoningEffortScopeMap(overrides, update.scope, providerId) }
  if (update.target == null) {
    delete nextMap[update.source]
  } else {
    nextMap[update.source] = update.target
  }
  return writeReasoningEffortScopeMap(overrides, update.scope, providerId, nextMap)
}
