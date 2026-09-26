// A probe outcome does not stay true forever — a provider's credit, quota, or uptime can change
// between one probe and the next — so every reader of ModelHealthMemory must expire it the same
// way, or the model picker and the router can disagree about the same model.

import type { ModelHealthMemory } from '@shared/data/preference/preferenceTypes'

/** How long a health probe outcome is trusted before it reads as unknown, same as never probed. */
export const MODEL_HEALTH_STALE_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * The record to act on: `undefined` once `checkedAt` is older than {@link MODEL_HEALTH_STALE_AFTER_MS},
 * identical to a model that was never probed. Applies to a success just as much as a failure — an
 * old `ok: true` is not evidence about right now either.
 */
export function freshModelHealth(
  record: ModelHealthMemory[string] | undefined,
  now: number = Date.now()
): ModelHealthMemory[string] | undefined {
  if (!record) return undefined
  return now - record.checkedAt < MODEL_HEALTH_STALE_AFTER_MS ? record : undefined
}
