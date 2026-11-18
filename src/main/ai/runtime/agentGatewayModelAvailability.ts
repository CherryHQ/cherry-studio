import { t } from '@main/i18n'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isGatewayRoutableModel } from '@shared/utils/model'
import { isExternalCliProvider } from '@shared/utils/provider'

import { AgentModelUnavailableError } from './agentModelUnavailableError'

/**
 * Actionable pre-flight check for Agent runtimes holding an already-resolved
 * `Provider` + `Model` pair. Mirrors the availability contract the API gateway
 * enforces for internal Agent traffic (enabled provider/model, routable model, no
 * external-CLI provider), but names the cause so a stale or
 * disabled Agent model surfaces as a configuration error before generation
 * instead of a late generic 400.
 */
export function assertAgentGatewayModelAvailable(provider: Provider, model: Model, modelAddress: string): void {
  if (provider.isEnabled === false) {
    throw new AgentModelUnavailableError(
      t('agent.model_unavailable.provider_disabled', { modelAddress, providerId: provider.id })
    )
  }
  if (model.isEnabled === false) {
    throw new AgentModelUnavailableError(t('agent.model_unavailable.model_disabled', { modelAddress }))
  }
  if (isExternalCliProvider(provider)) {
    throw new AgentModelUnavailableError(t('agent.model_unavailable.gateway_unroutable', { modelAddress }))
  }
  if (!isGatewayRoutableModel(model)) {
    throw new AgentModelUnavailableError(t('agent.model_unavailable.gateway_unroutable', { modelAddress }))
  }
}
