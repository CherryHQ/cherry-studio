import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
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
 * Resolve the `@ai-sdk` provider id (adapter family) for the model's **active** endpoint
 * (`model.endpointTypes[0]`, falling back to `provider.defaultChatEndpoint`, then
 * `OPENAI_CHAT_COMPLETIONS`), so per-model routing matches the endpoint the request uses.
 */
export function getAiSdkProviderId(provider: Provider, model: Model): AppProviderId {
  const endpointType = resolveEffectiveEndpoint(provider, model).endpointType ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  return resolveAiSdkProviderId(provider, endpointType)
}
