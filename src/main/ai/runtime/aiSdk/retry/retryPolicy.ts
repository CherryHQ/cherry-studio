import { application } from '@application'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { RetryFallbackModelId } from '@shared/data/preference/preferenceTypes'

import type { RecoverableModelTransportFailure } from '../failureFacts'

export const MIN_RETRY_ATTEMPTS = 1
export const MAX_RETRY_ATTEMPTS = 10

export const MIN_IMAGE_RETRY_ATTEMPTS = 0
export const DEFAULT_IMAGE_MAX_RETRIES = DefaultPreferences.default['image.retry.max_attempts']

const MODEL_TRANSPORT_RETRY = { maxRetries: 3, baseDelayMs: 2_000, maxDelayMs: 60_000 }

export function planModelTransportRetry(
  failure: RecoverableModelTransportFailure | undefined,
  { attempt, retryStreak }: { attempt: number; retryStreak?: number },
  limits = MODEL_TRANSPORT_RETRY
) {
  if (failure === undefined || (failure === 'interrupted' && attempt > limits.maxRetries)) return undefined

  const nextStreak = failure === 'network-unavailable' ? (retryStreak ?? 0) + 1 : undefined
  return {
    delayMs: Math.min(limits.maxDelayMs, limits.baseDelayMs * 2 ** ((nextStreak ?? attempt) - 1)),
    nextAttempt: nextStreak === undefined ? attempt + 1 : attempt,
    retryStreak: nextStreak,
    visibleAttempt: attempt + (retryStreak ?? 0) + 1
  }
}

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
