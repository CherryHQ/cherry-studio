import { application } from '@application'
import type { RetryFallbackModelId } from '@shared/data/preference/preferenceTypes'

import type { RecoverableModelTransportFailure } from '../failureFacts'

export const MIN_RETRY_ATTEMPTS = 1
export const MAX_RETRY_ATTEMPTS = 10

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
