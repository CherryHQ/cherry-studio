import { application } from '@application'
import type { RetryFallbackModelId } from '@shared/data/preference/preferenceTypes'

export const MIN_RETRY_ATTEMPTS = 1
export const MAX_RETRY_ATTEMPTS = 10

export const MIN_IMAGE_RETRY_ATTEMPTS = 0
export const DEFAULT_IMAGE_MAX_RETRIES = 2

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

/** Direct image-generation retries: 0 disables (each retry may bill again). */
export function readImageMaxRetries(): number {
  const preferences = application.get('PreferenceService')
  const configured = preferences.get('image.retry.max_attempts')
  const finiteAttempts = Number.isFinite(configured) ? configured : DEFAULT_IMAGE_MAX_RETRIES

  return Math.min(MAX_RETRY_ATTEMPTS, Math.max(MIN_IMAGE_RETRY_ATTEMPTS, Math.trunc(finiteAttempts)))
}
