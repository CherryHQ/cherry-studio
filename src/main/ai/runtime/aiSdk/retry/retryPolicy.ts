import { application } from '@application'
import type { RetryFallbackModelId } from '@shared/data/preference/preferenceTypes'

import { buildAutoFallbackModelIds } from './autoFallbackModels'
import { orderFallbackModels } from './orderFallbackModels'

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

  const configuredFallbacks = preferences.get('chat.retry.fallback_model_ids')
  const healthPriority = preferences.get('chat.retry.health_priority_enabled')
  const health = preferences.get('chat.retry.model_health')

  // With health priority on and no hand-picked list, fall back to whatever passed its last probe —
  // otherwise a failing model just fails for anyone who never configured a chain.
  const fallbackModelIds = healthPriority
    ? orderFallbackModels(
        configuredFallbacks.length > 0 ? configuredFallbacks : buildAutoFallbackModelIds(health),
        health
      )
    : configuredFallbacks

  return {
    enabled: preferences.get('chat.retry.enabled'),
    maxAttempts: Math.min(MAX_RETRY_ATTEMPTS, Math.max(MIN_RETRY_ATTEMPTS, Math.trunc(finiteAttempts))),
    backoffEnabled: preferences.get('chat.retry.backoff_enabled'),
    fallbackModelIds
  }
}
