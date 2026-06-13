/**
 * Pure collapse of the 3-layer context-settings model (global → assistant
 * → topic) into a resolved `EffectiveContextSettings`. Per-field precedence:
 * `topic ?? assistant ?? globals`.
 *
 * The compression model gets only its EXPLICIT pick here (`topic ??
 * assistant ?? globals`, else null). The "fall back to the current request
 * model" step is the CALLER's job (buildAgentParams) — keeping this helper
 * pure and free of request/model context so it stays trivially testable.
 *
 * NOTE: assistant/topic overrides are accepted but not yet supplied by the
 * pipeline — global prefs are the only wired layer until the P2-D settings
 * UI lands. The signature is 3-layer-complete so P2-D needs no change here.
 */
import type { ContextSettingsOverride, EffectiveContextSettings } from '@shared/data/types/contextSettings'

export interface ResolveContextSettingsInput {
  /** Resolved global defaults (from `chat.context_settings.*` prefs). */
  globals: EffectiveContextSettings
  /** Per-assistant override (assistant.settings.contextSettings). */
  assistant?: ContextSettingsOverride
  /** Per-topic override (topic.contextSettings). */
  topic?: ContextSettingsOverride | null
}

export function resolveContextSettings(input: ResolveContextSettingsInput): EffectiveContextSettings {
  const { globals, assistant, topic } = input

  return {
    enabled: topic?.enabled ?? assistant?.enabled ?? globals.enabled,
    truncateThreshold: topic?.truncateThreshold ?? assistant?.truncateThreshold ?? globals.truncateThreshold,
    compress: {
      enabled: topic?.compress?.enabled ?? assistant?.compress?.enabled ?? globals.compress.enabled,
      // `??` treats null/undefined alike: users disable compression via
      // `compress.enabled = false`, never by nulling the modelId.
      modelId: topic?.compress?.modelId ?? assistant?.compress?.modelId ?? globals.compress.modelId
    }
  }
}
