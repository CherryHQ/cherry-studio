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
 * The assistant layer is wired (P2-D); the topic layer is accepted but not
 * yet supplied by the pipeline.
 */
import type { ContextSettingsOverride, EffectiveContextSettings } from '@shared/data/types/contextSettings'

export interface ResolveContextSettingsInput {
  /** Resolved global defaults (from `chat.context_settings.*` prefs). */
  globals: EffectiveContextSettings
  /** Per-assistant override (assistant.settings.contextSettings; null = none stored). */
  assistant?: ContextSettingsOverride | null
  /** Per-topic override (topic.contextSettings). */
  topic?: ContextSettingsOverride | null
}

export function resolveContextSettings(input: ResolveContextSettingsInput): EffectiveContextSettings {
  const { globals, assistant, topic } = input

  return {
    enabled: topic?.enabled ?? assistant?.enabled ?? globals.enabled,
    truncateThreshold: topic?.truncateThreshold ?? assistant?.truncateThreshold ?? globals.truncateThreshold,
    maxMessages: topic?.maxMessages ?? assistant?.maxMessages ?? globals.maxMessages,
    compress: {
      enabled: topic?.compress?.enabled ?? assistant?.compress?.enabled ?? globals.compress.enabled,
      // `??` treats null/undefined alike: users disable compression via
      // `compress.enabled = false`, never by nulling the modelId.
      modelId: topic?.compress?.modelId ?? assistant?.compress?.modelId ?? globals.compress.modelId
    }
  }
}
