import type { StringKeys } from '@cherrystudio/ai-core/provider'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { AppProviderSettingsMap } from '../types'
import { resolveProviderAiSdkConfig } from './config'
import type { ServingCredentialReceipt } from './credential'
import { type ResolvedEndpoint, resolveProviderOptionsKey, resolveWireModelId } from './endpoint'

export type AppProviderKey = StringKeys<AppProviderSettingsMap>

/** Provider config plus the wire model id and providerOptions namespace a call needs. */
export interface SdkConfig<T extends AppProviderKey = AppProviderKey> {
  readonly providerId: T
  readonly providerOptionsKey: string
  readonly providerSettings: AppProviderSettingsMap[T]
  readonly modelId: string
  /** See `ProviderConfig.conversationHeader`. */
  readonly conversationHeader?: string
}

/**
 * Resolve everything the AI SDK needs to address one (provider, model) pair.
 * Modality-agnostic: chat, embedding, rerank and image calls all start here;
 * the chat pipeline (`buildAgentParams`) layers tools, prompt and context on top.
 */
export async function resolveSdkConfig(
  provider: Provider,
  model: Model,
  resolvedEndpoint: ResolvedEndpoint,
  apiKeyOverride?: string
): Promise<{ sdkConfig: SdkConfig; credentialReceipt: ServingCredentialReceipt }> {
  const { config, credentialReceipt } = await resolveProviderAiSdkConfig(provider, model, {
    apiKeyOverride,
    resolvedEndpoint
  })
  return {
    sdkConfig: {
      ...config,
      providerOptionsKey: resolveProviderOptionsKey(config.providerId, {
        actualProviderId: provider.id,
        endpointType: resolvedEndpoint.endpointType,
        gatewayProviderOptionsKey: resolvedEndpoint.providerOptionsKey
      }),
      modelId: resolveWireModelId(model, resolvedEndpoint.endpointType)
    },
    credentialReceipt
  }
}
