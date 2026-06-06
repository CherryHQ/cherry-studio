import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

const logger = loggerService.withContext('ApiGatewayUtils')

/**
 * OpenAI `/v1/models`-shaped model entry surfaced by the gateway.
 * Defined locally — the renderer's old `ApiModel` type is gone in the new
 * data model.
 */
export interface ApiModel {
  id: string
  object: 'model'
  created: number
  owned_by: string
}

export interface ApiModelsResponse {
  object: 'list'
  data: ApiModel[]
}

/**
 * Enabled providers from the data layer. The new data model exposes providers
 * through `ProviderService`, not Redux.
 */
export async function getAvailableProviders(): Promise<Provider[]> {
  try {
    return await providerService.list({ enabled: true })
  } catch (error) {
    logger.error('Failed to list providers', error as Error)
    return []
  }
}

/**
 * All enabled models across enabled providers, via `ModelService`.
 */
export async function listAllAvailableModels(providers?: Provider[]): Promise<Model[]> {
  try {
    if (!providers) {
      return await modelService.list({ enabled: true })
    }
    const results = await Promise.allSettled(
      providers.map((p) => modelService.list({ providerId: p.id, enabled: true }))
    )
    return results.flatMap((result, i) => {
      if (result.status === 'fulfilled') return result.value
      logger.error(`Failed to list models for provider ${providers[i].id}`, result.reason as Error)
      return []
    })
  } catch (error) {
    logger.error('Failed to list available models', error as Error)
    return []
  }
}

/**
 * Resolve a provider by id (enabled only). Returns undefined when missing.
 */
export async function getProviderById(providerId: string): Promise<Provider | undefined> {
  if (!providerId || typeof providerId !== 'string') {
    logger.warn('Invalid provider ID parameter', { providerId })
    return undefined
  }
  try {
    const provider = await providerService.getByProviderId(providerId)
    if (!provider.isEnabled) {
      logger.debug('Provider is disabled', { providerId })
      return undefined
    }
    return provider
  } catch {
    logger.warn('Provider not found by ID', { providerId })
    return undefined
  }
}

/**
 * Split a gateway model string `"providerId:modelId"` on the FIRST ':' into its
 * provider and model parts. Returns undefined when the format is invalid.
 */
export function parseGatewayModelString(model: string): { providerId: string; modelId: string } | undefined {
  if (!model || typeof model !== 'string') return undefined
  const idx = model.indexOf(':')
  if (idx <= 0) return undefined
  const providerId = model.slice(0, idx)
  const modelId = model.slice(idx + 1)
  if (!providerId || !modelId) return undefined
  return { providerId, modelId }
}

/**
 * Project a data-layer `Model` into the OpenAI `/v1/models` entry shape. The
 * `id` is the gateway-addressable `"providerId:modelId"`.
 */
export function transformModelToOpenAI(model: Model, provider?: Provider): ApiModel {
  const apiModelId = model.apiModelId ?? model.id
  return {
    id: `${model.providerId}:${apiModelId}`,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: model.ownedBy || provider?.name || model.providerId
  }
}
