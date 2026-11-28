import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { OAuthAuthenticationRequiredError } from '@main/services/oauth/errors'
import { isManagedCherryAiDefaultModel } from '@shared/data/presets/cherryai'
import { type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { formatGatewayModelId } from '@shared/utils/apiGateway'
import { isGatewayRoutableModel, isPublicGatewayRoutableModel, stripClaudeContextMarker } from '@shared/utils/model'
import { isAgentOnlyProvider, isExternalCliProvider, isLoginBasedProvider } from '@shared/utils/provider'

const logger = loggerService.withContext('ApiGatewayModels')

/**
 * OpenAI `/v1/models`-shaped model entry surfaced by the gateway. Defined locally —
 * the renderer's old `ApiModel` type is gone in the new data model.
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

/** Optional pagination filter for the gateway `/v1/models` listing. */
export interface ModelsFilter {
  offset?: number
  limit?: number
}

export interface ResolvedGatewayModelAddress {
  providerId: string
  apiModelId: string
  uniqueModelId: UniqueModelId
  provider: Provider
  model: Model
}

function gatewayModelError(message: string, status: number): Error & { status: number } {
  const error = new Error(message) as Error & { status: number }
  error.status = status
  return error
}

/** Enabled providers from the data layer (`ProviderService`, not Redux). */
function getAvailableProviders(): Provider[] {
  try {
    return providerService.list({ enabled: true })
  } catch (error) {
    logger.error('Failed to list providers', error as Error)
    return []
  }
}

/** All enabled models across enabled providers, via `ModelService`. */
async function listAllAvailableModels(providers?: Provider[]): Promise<Model[]> {
  try {
    if (!providers) {
      return modelService.list({ enabled: true })
    }
    const models: Model[] = []
    for (const provider of providers) {
      try {
        models.push(...modelService.list({ providerId: provider.id, enabled: true }))
      } catch (error) {
        logger.error(`Failed to list models for provider ${provider.id}`, error as Error)
      }
    }
    return models
  } catch (error) {
    logger.error('Failed to list available models', error as Error)
    return []
  }
}

/**
 * Project a data-layer `Model` into the OpenAI `/v1/models` entry shape. The `id` is
 * the gateway-addressable `"providerId:apiModelId"`.
 */
function transformModelToOpenAi(model: Model, provider?: Provider): ApiModel {
  const apiModelId = model.apiModelId ?? parseUniqueModelId(model.id).modelId
  return {
    id: formatGatewayModelId(model.providerId, apiModelId),
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: model.ownedBy || provider?.name || model.providerId
  }
}

/** Resolve an enabled gateway model by its `providerId:apiModelId` address. */
export async function resolveGatewayModelAddress(
  modelAddress: string,
  internal = false
): Promise<ResolvedGatewayModelAddress> {
  const sepIdx = modelAddress.indexOf(':')
  if (sepIdx <= 0 || sepIdx >= modelAddress.length - 1) {
    throw gatewayModelError(`Invalid model format: "${modelAddress}". Expected "providerId:apiModelId".`, 400)
  }

  const providerId = modelAddress.slice(0, sepIdx)
  const apiModelId = modelAddress.slice(sepIdx + 1)
  if (isManagedCherryAiDefaultModel(providerId, apiModelId)) {
    throw gatewayModelError('CherryAI managed default model is not available through the API gateway', 400)
  }

  let provider: Provider
  try {
    provider = providerService.getByProviderId(providerId)
  } catch {
    throw gatewayModelError(`Model "${modelAddress}" is not available through the API gateway`, 400)
  }
  if (isExternalCliProvider(provider)) {
    throw gatewayModelError(`Model "${modelAddress}" is not available through the API gateway`, 400)
  }
  if (isLoginBasedProvider(provider) && provider.authMethods?.includes('oauth')) {
    const authConfig = providerService.getAuthConfig(providerId)
    if (authConfig?.type !== 'oauth' || !authConfig.accessToken) {
      throw new OAuthAuthenticationRequiredError(providerId)
    }
  }
  if (!provider.isEnabled) {
    throw gatewayModelError(`Model "${modelAddress}" is not available through the API gateway`, 400)
  }

  const isRoutableModel = internal ? isGatewayRoutableModel : isPublicGatewayRoutableModel
  const candidates = modelService
    .list({ providerId, enabled: true })
    .filter((candidate) => isRoutableModel(candidate))
    .map((candidate) => ({ candidate, id: candidate.apiModelId ?? parseUniqueModelId(candidate.id).modelId }))
  // Exact ids win, so catalog models whose id itself ends in `[1m]` stay addressable. Otherwise fall
  // back to the id without a Claude Code context marker / trailing whitespace (e.g. `model [1M]`, or
  // `model ` after Claude Code strips the bracket token from a spaced marker).
  const normalizedApiModelId = stripClaudeContextMarker(apiModelId)
  const match =
    candidates.find(({ id }) => id === apiModelId) ??
    (normalizedApiModelId && normalizedApiModelId !== apiModelId
      ? candidates.find(({ id }) => id === normalizedApiModelId)
      : undefined)
  if (!match) {
    throw gatewayModelError(`Model "${modelAddress}" is not available through the API gateway`, 400)
  }

  return { providerId, apiModelId: match.id, uniqueModelId: match.candidate.id, provider, model: match.candidate }
}

export async function getGatewayModelCatalog(): Promise<{ apiModel: ApiModel; name: string }[]> {
  try {
    const providers = getAvailableProviders()
    const models = await listAllAvailableModels(providers)

    // Deduplicate by the gateway-addressable id ("providerId:apiModelId").
    const uniqueModels = new Map<string, { apiModel: ApiModel; name: string }>()
    for (const model of models) {
      const provider = providers.find((p) => p.id === model.providerId)
      // External-CLI providers carry no app-side credentials and cannot be proxied.
      if (provider && isAgentOnlyProvider(provider)) {
        continue
      }
      // Same routable-model predicate as the renderer's gateway picker — the
      // listing must never advertise a model the proxy cannot route.
      if (!isPublicGatewayRoutableModel(model)) {
        continue
      }

      const apiModel = transformModelToOpenAi(model, provider)
      if (!uniqueModels.has(apiModel.id)) {
        uniqueModels.set(apiModel.id, { apiModel, name: model.name })
      }
    }

    return Array.from(uniqueModels.values())
  } catch (error) {
    logger.error('Error getting models', error as Error)
    return []
  }
}

/** Build the optionally paginated OpenAI `/v1/models` listing. */
export async function getModels({ offset = 0, limit }: ModelsFilter = {}): Promise<ApiModelsResponse> {
  const catalog = await getGatewayModelCatalog()
  const page = limit === undefined ? catalog.slice(Math.max(offset, 0)) : catalog.slice(offset, offset + limit)
  logger.info('Models retrieved', { returned: page.length, available: catalog.length })
  return { object: 'list', data: page.map(({ apiModel }) => apiModel) }
}
