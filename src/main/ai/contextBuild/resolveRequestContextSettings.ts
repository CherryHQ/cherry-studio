import { application } from '@application'
import type { ContextSettingsOverride, EffectiveContextSettings } from '@shared/data/types/contextSettings'
import type { Model } from '@shared/data/types/model'

import { type CompressionModelDescriptor, resolveCompressionModel } from './resolveCompressionModel'
import { resolveContextSettings } from './resolveContextSettings'

/** The global layer: the four `chat.context_settings.*` preferences. Shared
 *  with the persist-time trimmer so both lanes resolve identically. */
export function resolveGlobalContextSettings(): EffectiveContextSettings {
  const prefs = application.get('PreferenceService')
  return {
    enabled: prefs.get('chat.context_settings.enabled'),
    truncateThreshold: prefs.get('chat.context_settings.truncate_threshold'),
    maxMessages: prefs.get('chat.context_settings.max_messages'),
    compress: {
      enabled: prefs.get('chat.context_settings.compress.enabled'),
      modelId: prefs.get('chat.context_settings.compress.model_id')
    }
  }
}

/**
 * Resolve effective context settings + compression model for a request.
 * Shared by the agent-params pipeline (in-flight middleware) and dispatch-time
 * durable compaction (PersistentChatContextProvider). Two layers: the globals
 * below, overridden per assistant.
 */
export async function resolveRequestContextSettings(
  model: Model,
  assistantOverride?: ContextSettingsOverride | null
): Promise<{ contextSettings: EffectiveContextSettings; compressionModel: CompressionModelDescriptor | null }> {
  const contextSettings = resolveContextSettings({
    globals: resolveGlobalContextSettings(),
    assistant: assistantOverride
  })

  let compressionModel: CompressionModelDescriptor | null = null
  if (contextSettings.enabled && contextSettings.compress.enabled) {
    // Explicit pick, else fall back to the current request model.
    //
    // Blank counts as "no pick", not as a pick of "". `??` alone would only
    // catch null/undefined, and the two layers can express emptiness
    // differently: the assistant override's schema is `z.string().min(1)` (so
    // clearing it yields null), but the GLOBAL preference is a plain
    // `string | null` — its schema is generated from classification.json and
    // cannot carry that refinement — so an empty string is representable there.
    // Left as-is it reached `resolveCompressionModel('')`, which returns null,
    // and compression silently switched off instead of using the current model.
    const compressId = contextSettings.compress.modelId?.trim() || model.id
    compressionModel = await resolveCompressionModel(compressId)
  }

  return { contextSettings, compressionModel }
}
