import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { AppProviderId } from '../types'
import { resolveAiSdkProviderId, resolveEffectiveEndpoint } from './endpoint'
import { extensions } from './extensions'

for (const extension of extensions) {
  if (!extensionRegistry.has(extension.config.name)) {
    extensionRegistry.register(extension)
  }
}

/**
 * Resolve the `@ai-sdk` provider id (adapter family) for the model's active text endpoint,
 * so per-model routing matches the endpoint the request uses.
 */
export function getAiSdkProviderId(provider: Provider, model: Model): AppProviderId {
  const endpointType =
    resolveEffectiveEndpoint(provider, model, { operationCapability: MODEL_CAPABILITY.TEXT_GENERATION }).endpointType ??
    ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  return resolveAiSdkProviderId(provider, endpointType)
}
