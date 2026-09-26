import { application } from '@application'
import type { RetryFallbackModelId } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId } from '@shared/data/types/model'

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
  const escalationEnabled = preferences.get('chat.routing.escalation_enabled')

  // With health priority on and no hand-picked list, fall back to whatever passed its last probe —
  // otherwise a failing model just fails for anyone who never configured a chain.
  const orderedFallbacks = healthPriority
    ? orderFallbackModels(
        configuredFallbacks.length > 0 ? configuredFallbacks : buildAutoFallbackModelIds(health),
        health,
        escalationEnabled
      )
    : configuredFallbacks

  // Answering with a different model changes the character of the reply, so it stays opt-in.
  // Same-model retries and API-key rotation are unaffected — neither changes who answers.
  const autoSwitchEnabled = preferences.get('chat.routing.auto_switch_enabled')
  let fallbackModelIds = autoSwitchEnabled ? orderedFallbacks : []

  // When all remote sources are exhausted, fall back to local model (L3).
  // This ensures "never reject a request" (Rule 2) even when all API keys are spent.
  // Only append local model if auto switch is enabled to respect user's opt-in choice.
  if (autoSwitchEnabled) {
    const localWorkerModel = preferences.get('chat.routing.local_worker_model')
    if (isUniqueModelId(localWorkerModel) && !fallbackModelIds.includes(localWorkerModel)) {
      fallbackModelIds = [...fallbackModelIds, localWorkerModel]
    }
  }

  return {
    enabled: preferences.get('chat.retry.enabled'),
    maxAttempts: Math.min(MAX_RETRY_ATTEMPTS, Math.max(MIN_RETRY_ATTEMPTS, Math.trunc(finiteAttempts))),
    backoffEnabled: preferences.get('chat.retry.backoff_enabled'),
    fallbackModelIds
  }
}
