import {
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
