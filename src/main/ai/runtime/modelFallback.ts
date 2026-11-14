import { agentService } from '@data/services/AgentService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import { isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

import { readRetryPolicy, type RetryPolicy } from './aiSdk'

/** Whether a configured fallback id still names a provider and model this app can actually reach. */
function isUsableFallback(candidate: UniqueModelId): boolean {
  const { providerId, modelId } = parseUniqueModelId(candidate)
  try {
    const provider = providerService.getByProviderId(providerId)
    // A disabled provider's models are refused by the gateway, so routing to one only buys an
    // opaque 404 — the same reason the chat retry path skips it (issue #20547).
    if (!provider.isEnabled) return false
    const model = modelService.getByKey(providerId, modelId)
    // `getByKey` returns disabled rows too, but the gateway resolves a request's address by
    // searching only enabled models, so a disabled one is refused there — skipping it here keeps
    // the turn's single fallback attempt for a candidate that can actually serve it.
    return model.isEnabled !== false
  } catch (error) {
    if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) return false
    throw error
  }
}

/**
 * First configured fallback that is a well-formed id, differs from the model that just failed, and is
 * still resolvable. Unusable entries are skipped rather than consumed: a turn gets ONE fallback
 * attempt, so a stale id in front of a healthy one would otherwise cost the turn its fallback
 * entirely — the same skip-and-continue rule the chat retry path applies to its own candidates.
 */
export function selectFallbackModelId(policy: RetryPolicy, currentModelId: UniqueModelId): UniqueModelId | undefined {
  if (!policy.enabled) return undefined
  return policy.fallbackModelIds.find(
    (candidate) => isUniqueModelId(candidate) && candidate !== currentModelId && isUsableFallback(candidate)
  )
}

/** The global retry policy widened to the agent's own fallback models whenever it configures any. */
export function resolveAgentFallbackPolicy(agentId: string): RetryPolicy {
  const global = readRetryPolicy()
  const configured = agentService.getAgent(agentId)?.configuration?.fallback_model_ids
  return configured?.length ? { ...global, enabled: true, fallbackModelIds: configured } : global
}
