import { preferenceService } from '@data/PreferenceService'
import { initI18n } from '@renderer/i18n/resolver'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'

interface PrepareWindowOptions {
  /** Preference keys the first frame reads — 'all' warms the entire cache. */
  preference: 'all' | UnifiedPreferenceKeyType[]
}

/**
 * Shared entry-point prologue: every window's `entryPoint.tsx` awaits this before
 * `createRoot().render()` so the first frame reads i18n and preferences from a warm
 * cache instead of falling back to defaults (the source of the theme flash, A2).
 *
 * Both preference paths are best-effort and never reject — a failed warm-up degrades
 * to defaults plus lazy per-key self-heal in `usePreference`.
 */
export async function prepareWindow(options: PrepareWindowOptions): Promise<void> {
  const preferencesWarm =
    options.preference === 'all' ? preferenceService.preloadAll() : preferenceService.preload(options.preference)

  await Promise.all([initI18n(), preferencesWarm])
}
