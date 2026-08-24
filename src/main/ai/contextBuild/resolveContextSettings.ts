/**
 * Pure collapse of the 2-layer context-settings model (global → assistant)
 * into a resolved `EffectiveContextSettings`. Per-field precedence:
 * `assistant ?? globals`.
 *
 * The compression model gets only its EXPLICIT pick here (`assistant ??
 * globals`, else null). The "fall back to the current request model" step is
 * the CALLER's job (buildAgentParams) — keeping this helper pure and free of
 * request/model context so it stays trivially testable.
 *
 * `maxMessages` is three-state and therefore merged by PROPERTY PRESENCE, not
 * `??`: `undefined` (absent) inherits, while an explicit `null` means "no
 * limit at this layer" and must beat a finite global. `??` cannot express that
 * — it treats null and undefined alike, so an assistant set to unlimited would
 * silently inherit a finite global instead.
 */
import type { ContextSettingsOverride, EffectiveContextSettings } from '@shared/data/types/contextSettings'

export interface ResolveContextSettingsInput {
  /** Resolved global defaults (from `chat.context_settings.*` prefs). */
  globals: EffectiveContextSettings
  /** Per-assistant override (assistant.settings.contextSettings; null = none stored). */
  assistant?: ContextSettingsOverride | null
}

export function resolveContextSettings(input: ResolveContextSettingsInput): EffectiveContextSettings {
  const { globals, assistant } = input

  return {
    enabled: assistant?.enabled ?? globals.enabled,
    truncateThreshold: assistant?.truncateThreshold ?? globals.truncateThreshold,
    maxMessages: assistant && 'maxMessages' in assistant ? (assistant.maxMessages ?? null) : globals.maxMessages,
    compress: {
      enabled: assistant?.compress?.enabled ?? globals.compress.enabled,
      // `??` treats null/undefined alike: users disable compression via
      // `compress.enabled = false`, never by nulling the modelId.
      modelId: assistant?.compress?.modelId ?? globals.compress.modelId
    }
  }
}
