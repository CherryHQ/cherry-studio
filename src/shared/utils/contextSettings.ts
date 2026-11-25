import {
  type ContextSettingsOverride,
  DEFAULT_CONTEXT_SETTINGS,
  MAX_COMPRESS_THRESHOLD_PERCENT,
  MIN_COMPRESS_THRESHOLD_PERCENT
} from '@shared/data/types/contextSettings'

/**
 * Bring a stored compaction trigger into range.
 *
 * `EffectiveContextSettingsSchema` is never `.parse()`d in production, so this
 * is the only runtime guard on the value: a hand-edited `0` would fold on every
 * step, and a non-finite one compares false against every estimate and would
 * fold forever. Non-finite (or absent) input falls back to the default.
 */
export function clampThresholdPercent(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CONTEXT_SETTINGS.compress.thresholdPercent
  return Math.min(MAX_COMPRESS_THRESHOLD_PERCENT, Math.max(MIN_COMPRESS_THRESHOLD_PERCENT, Math.floor(value)))
}

// Invalid stored limits preserve unlimited history rather than dropping context or indexing past its end.
export function normalizeMaxMessages(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const floored = Math.floor(value)
  return floored >= 1 ? floored : null
}

// Extend backward so a resumed assistant turn keeps its prompt; short histories remain untouched.
export function applyMaxMessagesWindow<T extends { role: string }>(messages: T[], maxMessages: number | null): T[] {
  const limit = normalizeMaxMessages(maxMessages)
  if (limit === null || messages.length <= limit) return messages
  let start = messages.length - limit
  while (start > 0 && messages[start].role !== 'user') start--
  return messages.slice(start)
}

/**
 * Merge the assistant's `maxMessages` over the global one by property presence:
 * an explicit assistant `null` ("no limit") must beat a finite global, which `??` cannot express.
 */
export function resolveMaxMessages(
  assistant: ContextSettingsOverride | null | undefined,
  globalMaxMessages: number | null
): number | null {
  return assistant && 'maxMessages' in assistant ? (assistant.maxMessages ?? null) : globalMaxMessages
}
