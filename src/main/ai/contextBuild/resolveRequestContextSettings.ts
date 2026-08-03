import type { LanguageModelV3 } from '@ai-sdk/provider'
import { application } from '@application'
import type { ContextSettingsOverride, EffectiveContextSettings } from '@shared/data/types/contextSettings'
import type { Model } from '@shared/data/types/model'

import { resolveCompressionModel } from './resolveCompressionModel'
import { resolveContextSettings } from './resolveContextSettings'

/** The global layer: the four `chat.context_settings.*` preferences. Shared
 *  with the persist-time trimmer so both lanes resolve identically. */
export function resolveGlobalContextSettings(): EffectiveContextSettings {
  const prefs = application.get('PreferenceService')
  return {
    enabled: prefs.get('chat.context_settings.enabled'),
    truncateThreshold: prefs.get('chat.context_settings.truncate_threshold'),
    compress: {
      enabled: prefs.get('chat.context_settings.compress.enabled'),
      modelId: prefs.get('chat.context_settings.compress.model_id')
    }
  }
}

/**
 * Resolve effective context settings + compression model for a request.
 * Shared by the agent-params pipeline (in-flight middleware) and dispatch-time
 * durable compaction (PersistentChatContextProvider). Layers: globals +
 * the assistant override (P2-D); the topic layer is not wired yet.
 */
export async function resolveRequestContextSettings(
  model: Model,
  assistantOverride?: ContextSettingsOverride | null
): Promise<{ contextSettings: EffectiveContextSettings; compressionModel: LanguageModelV3 | null }> {
  const contextSettings = resolveContextSettings({
    globals: resolveGlobalContextSettings(),
    assistant: assistantOverride
  })

  let compressionModel: LanguageModelV3 | null = null
  if (contextSettings.enabled && contextSettings.compress.enabled) {
    // Explicit pick, else fall back to the current request model.
    const compressId = contextSettings.compress.modelId ?? model.id
    compressionModel = await resolveCompressionModel(compressId)
  }

  return { contextSettings, compressionModel }
}
