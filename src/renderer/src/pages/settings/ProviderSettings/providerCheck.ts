import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { type Model, type Provider, SystemProviderIds } from '@renderer/types'

export type ProviderHostField = 'apiHost' | 'anthropicApiHost'

export function getApiCheckModels(models: Model[], hostField: ProviderHostField): Model[] {
  const checkableModels = models.filter(
    (model) => !isRerankModel(model) && (hostField !== 'anthropicApiHost' || !isEmbeddingModel(model))
  )

  if (hostField === 'anthropicApiHost') {
    return checkableModels
  }

  return checkableModels.toSorted(
    (firstModel, secondModel) => Number(isEmbeddingModel(firstModel)) - Number(isEmbeddingModel(secondModel))
  )
}

interface BuildApiCheckProviderOptions {
  provider: Provider
  hostField: ProviderHostField
  apiHost: string
  anthropicApiHost?: string
  apiKey: string
}

export function buildApiCheckProvider({
  provider,
  hostField,
  apiHost,
  anthropicApiHost,
  apiKey
}: BuildApiCheckProviderOptions): Provider {
  const host = (hostField === 'anthropicApiHost' ? anthropicApiHost : apiHost)?.trim()

  if (!host) {
    throw new Error('API host is required')
  }

  if (hostField === 'anthropicApiHost') {
    // Provider IDs take precedence over provider types during SDK resolution.
    // Use the canonical ID so registered providers still switch to the Anthropic protocol.
    return {
      ...provider,
      id: SystemProviderIds.anthropic,
      type: 'anthropic',
      authType: 'apiKey',
      apiHost: host,
      anthropicApiHost: host,
      apiKey
    }
  }

  return { ...provider, apiHost: host, apiKey }
}
