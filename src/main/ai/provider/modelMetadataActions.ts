import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { ModelMetadataField } from '@shared/data/types/modelMetadata'

import { getBaseUrl } from '../utils/provider'
import { resolveEffectiveEndpoint } from './endpoint'

/** Endpoint families whose model listing is the same `GET {baseUrl}/models` catalog. */
const OPENAI_CATALOG_ENDPOINTS = new Set<EndpointType>([
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.OPENAI_RESPONSES
])

/** Only explicit settings actions enter here. Ordinary listing has no write path. */
export async function refreshCustomModelMetadata(providerId: string, modelId: string) {
  // Verify local identity before issuing a request or changing any stored values.
  const model = modelService.getByKey(providerId, modelId)
  const provider = providerService.getByProviderId(providerId)
  const endpoint = resolveEffectiveEndpoint(provider, model)
  // Listing uses the provider default; never persist another endpoint's declaration.
  // Chat Completions and Responses configured at one base URL resolve the same
  // `GET /models` catalog, so only the refusal for a genuinely different route remains.
  const sameCatalog =
    endpoint.endpointType !== undefined &&
    provider.defaultChatEndpoint !== undefined &&
    (endpoint.endpointType === provider.defaultChatEndpoint ||
      (OPENAI_CATALOG_ENDPOINTS.has(endpoint.endpointType) &&
        OPENAI_CATALOG_ENDPOINTS.has(provider.defaultChatEndpoint) &&
        endpoint.baseUrl !== '' &&
        endpoint.baseUrl === getBaseUrl(provider, provider.defaultChatEndpoint)))
  if (!sameCatalog) {
    throw DataApiErrorFactory.invalidOperation(
      'refresh model metadata',
      'The model uses a non-default endpoint; metadata refresh is unavailable for this route'
    )
  }
  const listing = await application.get('AiService').listModels({ providerId, throwOnError: true })
  const listed = listing.models.find((model) => model.apiModelId === modelId)
  if (!listed) throw DataApiErrorFactory.notFound('Provider model', modelId)
  if (!listed.providerMetadata) {
    throw DataApiErrorFactory.invalidOperation(
      'refresh model metadata',
      'This provider does not expose custom-channel metadata'
    )
  }
  return modelService.applyProviderMetadata(providerId, modelId, listed.providerMetadata)
}

export function resetCustomModelMetadata(providerId: string, modelId: string, field: ModelMetadataField) {
  return modelService.applyProviderMetadata(providerId, modelId, {}, field)
}
