// Probe outcomes outlive the settings window that triggered them: the renderer's health cache is
// casual (dropped on restart) and invisible to main, where fallback ordering actually happens.

import { application } from '@application'
import { loggerService } from '@logger'
import type { UniqueModelId } from '@shared/data/types/model'

const logger = loggerService.withContext('ModelHealthMemory')

/** Persists a probe outcome so {@link orderFallbackModels} can prefer models that still answer. */
export async function recordModelHealth(
  uniqueModelId: UniqueModelId | undefined,
  ok: boolean,
  latency?: number
): Promise<void> {
  if (!uniqueModelId) return
  try {
    const preferences = application.get('PreferenceService')
    const current = preferences.get('chat.retry.model_health')
    await preferences.set('chat.retry.model_health', {
      ...current,
      [uniqueModelId]: { ok, checkedAt: Date.now(), ...(latency !== undefined && { latency }) }
    })
  } catch (error) {
    // Losing a health note must never fail the probe the user asked for.
    logger.warn('failed to persist model health', { uniqueModelId, error })
  }
}
