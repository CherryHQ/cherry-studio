import { createAnthropic } from '@ai-sdk/anthropic'
import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'

import { extensionRegistry } from '@cherrystudio/ai-core/provider'
import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { providerToAiSdkConfig } from './config'
import { resolveAiSdkProviderId, resolveWireModelId } from './endpoint'
import './factory'

const anthropicModelClass = createAnthropic({ apiKey: 'transport-probe' }).languageModel('probe').constructor

export async function resolveModelTransportKind(
  provider: Provider,
  model: Model,
  endpointType: EndpointType | undefined
): Promise<'anthropic-messages' | undefined> {
  const endpoint = endpointType && provider.endpointConfigs?.[endpointType]
  if (
    endpointType !== ENDPOINT_TYPE.ANTHROPIC_MESSAGES ||
    !endpoint?.baseUrl ||
    !extensionRegistry.has(resolveAiSdkProviderId(provider, endpointType))
  )
    return undefined
  try {
    const config = await providerToAiSdkConfig(provider, model, {
      transportProbe: true,
      resolvedEndpoint: { endpointType, baseUrl: endpoint.baseUrl }
    })
    const adapter = await extensionRegistry.createProvider(config.providerId, {
      ...config.providerSettings,
      headers: {}
    })
    const resolveModel = extensionRegistry.getModelResolver(config.providerId)
    const modelId = resolveWireModelId(model, endpointType)
    const languageModel = resolveModel ? resolveModel(adapter, modelId) : adapter.languageModel(modelId)
    return languageModel instanceof AnthropicMessagesLanguageModel || languageModel?.constructor === anthropicModelClass
      ? 'anthropic-messages'
      : undefined
  } catch {
    return undefined
  }
}
