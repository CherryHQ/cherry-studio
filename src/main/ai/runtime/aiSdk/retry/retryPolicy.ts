import { application } from '@application'
import { MAX_RETRY_FALLBACK_MODELS } from '@shared/ai/retry'
import type { RetryFallbackModelId } from '@shared/data/preference/preferenceTypes'

export const MIN_RETRY_ATTEMPTS = 1
export const MAX_RETRY_ATTEMPTS = 10

export interface RetryPolicy {
  enabled: boolean
  maxAttempts: number
  backoffEnabled: boolean
  fallbackModelIds: readonly RetryFallbackModelId[]
}

export function readRetryPolicy(): RetryPolicy {
  const preferences = application.get('PreferenceService')
  const configuredAttempts = preferences.get('chat.retry.max_attempts')
  const finiteAttempts = Number.isFinite(configuredAttempts) ? configuredAttempts : MIN_RETRY_ATTEMPTS
  // Caps the per-call fan-out so attempts × fallbacks stays within 11 × 6 billable calls.
  const fallbackModelIds = preferences.get('chat.retry.fallback_model_ids').slice(0, MAX_RETRY_FALLBACK_MODELS)

  return {
    enabled: preferences.get('chat.retry.enabled'),
    maxAttempts: Math.min(MAX_RETRY_ATTEMPTS, Math.max(MIN_RETRY_ATTEMPTS, Math.trunc(finiteAttempts))),
    backoffEnabled: preferences.get('chat.retry.backoff_enabled'),
    fallbackModelIds
  }
}
