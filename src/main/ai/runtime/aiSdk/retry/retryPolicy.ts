import { application } from '@application'
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

  return {
    enabled: preferences.get('chat.retry.enabled'),
    maxAttempts: Math.min(MAX_RETRY_ATTEMPTS, Math.max(MIN_RETRY_ATTEMPTS, Math.trunc(finiteAttempts))),
    backoffEnabled: preferences.get('chat.retry.backoff_enabled'),
    fallbackModelIds: preferences.get('chat.retry.fallback_model_ids')
  }
}

/** Same fallback list `buildFallbackModels` would use for attachment budgeting. */
export function resolveEffectiveFallbackModelIds(
  requestMaxRetries: number | undefined,
  retryDisabledForRequest: boolean,
  hasApiKeyFallbacks: boolean
): readonly RetryFallbackModelId[] {
  if (retryDisabledForRequest) return []
  const configured = readRetryPolicy()
  const retryPolicy =
    configured.enabled || !hasApiKeyFallbacks || requestMaxRetries === undefined || requestMaxRetries <= 0
      ? configured
      : {
          ...configured,
          enabled: true,
          maxAttempts: Math.max(MIN_RETRY_ATTEMPTS, Math.trunc(requestMaxRetries)),
          fallbackModelIds: [] as const
        }
  return retryPolicy.enabled ? retryPolicy.fallbackModelIds : []
}
