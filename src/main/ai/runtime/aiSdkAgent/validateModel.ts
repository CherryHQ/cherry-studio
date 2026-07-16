/**
 * Fail-closed provider/model validation for the AI SDK agent runtime.
 * Mirrors pi's `assertPiProviderUsable`: unsupported beats missing-credential,
 * and the check is side-effect free (no API-key rotation is consumed).
 */

import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { isAiSdkAgentCompatibleModel } from '@shared/ai/aiSdkAgentCompatibility'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

export class AiSdkAgentUnsupportedModelError extends Error {
  constructor(providerId: string, modelId: string) {
    super(`Provider/model "${providerId}::${modelId}" cannot be driven by the AI SDK agent runtime`)
    this.name = 'AiSdkAgentUnsupportedModelError'
  }
}

export class AiSdkAgentMissingApiKeyError extends Error {
  constructor(providerId: string) {
    super(`Provider "${providerId}" has no enabled API key`)
    this.name = 'AiSdkAgentMissingApiKeyError'
  }
}

/**
 * Assert an already-resolved provider/model pair is usable. Key presence is
 * only required for plain api-key providers — OAuth/IAM providers authenticate
 * through their own config builders.
 */
export function assertAiSdkAgentProviderUsable(provider: Provider, model: Model): void {
  if (!isAiSdkAgentCompatibleModel(provider, model)) {
    throw new AiSdkAgentUnsupportedModelError(provider.id, model.apiModelId ?? model.id)
  }
  if (provider.authType === 'api-key') {
    const apiKeys = providerService.getApiKeys(provider.id, { enabled: true })
    if (!apiKeys.some((entry) => entry.key.trim())) throw new AiSdkAgentMissingApiKeyError(provider.id)
  }
}

/**
 * Resolve a unique model id to its provider/model and assert usability.
 * A missing provider or model throws the data layer's notFound — equally
 * fail-closed for dispatch validation.
 */
export function resolveAndAssertAiSdkAgentModel(uniqueModelId: UniqueModelId): {
  provider: Provider
  model: Model
} {
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  const provider = providerService.getByProviderId(providerId)
  const model = modelService.getByKey(providerId, modelId)
  assertAiSdkAgentProviderUsable(provider, model)
  return { provider, model }
}
