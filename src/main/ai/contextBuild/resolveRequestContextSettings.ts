import type { LanguageModelV3 } from '@ai-sdk/provider'
import { application } from '@application'
import type { EffectiveContextSettings } from '@shared/data/types/contextSettings'
import type { Model } from '@shared/data/types/model'

import { resolveCompressionModel } from './resolveCompressionModel'
import { resolveContextSettings } from './resolveContextSettings'

/**
 * Resolve effective context settings + compression model for a request.
 * Shared by the agent-params pipeline (in-flight middleware) and dispatch-time
 * durable compaction (PersistentChatContextProvider). Globals only until P2-D.
 */
export async function resolveRequestContextSettings(
  model: Model
): Promise<{ contextSettings: EffectiveContextSettings; compressionModel: LanguageModelV3 | null }> {
  const prefs = application.get('PreferenceService')
  const globals: EffectiveContextSettings = {
    enabled: prefs.get('chat.context_settings.enabled'),
    truncateThreshold: prefs.get('chat.context_settings.truncate_threshold'),
    compress: {
      enabled: prefs.get('chat.context_settings.compress.enabled'),
      modelId: prefs.get('chat.context_settings.compress.model_id')
    }
  }

  const contextSettings = resolveContextSettings({ globals })

  let compressionModel: LanguageModelV3 | null = null
  if (contextSettings.enabled && contextSettings.compress.enabled) {
    // Explicit pick, else fall back to the current request model.
    const compressId = contextSettings.compress.modelId ?? model.id
    compressionModel = await resolveCompressionModel(compressId)
  }

  return { contextSettings, compressionModel }
}
