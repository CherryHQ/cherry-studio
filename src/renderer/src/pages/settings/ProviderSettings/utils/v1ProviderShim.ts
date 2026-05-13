// TODO(v2-cleanup): Delete this file after Phase 5 migration is complete.
// Temporary bridge: ProviderSettings already reads/writes the Data API runtime
// provider/model shape, but several downstream renderer entrypoints still call
// legacy aiCore / ApiService helpers that expect the old v1 provider/model
// contracts from `@renderer/types`. Once those callers migrate to the runtime
// aiCore/data-api shape, remove this shim and its call sites together.

import type { Model as V1Model, Provider as V1Provider, ProviderType } from '@renderer/types'
import type { Model as V2Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider as V2Provider } from '@shared/data/types/provider'

export interface V1ShimOptions {
  /** From useModels(); v2 Model and v1 Model are runtime-compatible here. */
  models?: V2Model[]
  /** From useProviderApiKeys() keys joined by comma, or the local form key. */
  apiKey?: string
  /** Overrides baseUrl inference, e.g. apiHost from the form. */
  apiHost?: string
}

function defaultChatBaseUrl(v2: V2Provider): string {
  const ep = v2.defaultChatEndpoint ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  return v2.endpointConfigs?.[ep]?.baseUrl ?? ''
}

function v1ProviderTypeFromV2(v2: V2Provider): ProviderType {
  if (v2.authType === 'iam-azure') {
    return 'azure-openai'
  }
  if (v2.authType === 'iam-gcp') {
    return 'vertexai'
  }
  if (v2.authType === 'iam-aws' || v2.authType === 'api-key-aws') {
    return 'aws-bedrock'
  }

  if (v2.id === 'new-api' || v2.presetProviderId === 'new-api') {
    return 'new-api'
  }
  if (v2.id === 'gateway') {
    return 'gateway'
  }
  if (v2.id === 'mistral' || v2.presetProviderId === 'mistral') {
    return 'mistral'
  }

  const ep = v2.defaultChatEndpoint ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS

  switch (ep) {
    case ENDPOINT_TYPE.OPENAI_RESPONSES:
      return 'openai-response'
    case ENDPOINT_TYPE.ANTHROPIC_MESSAGES:
      return 'anthropic'
    case ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT:
      return 'gemini'
    case ENDPOINT_TYPE.OLLAMA_CHAT:
    case ENDPOINT_TYPE.OLLAMA_GENERATE:
      return 'ollama'
    case ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS:
    case ENDPOINT_TYPE.OPENAI_TEXT_COMPLETIONS:
    default:
      return 'openai'
  }
}

function apiFeaturesToApiOptions(v2: V2Provider): V1Provider['apiOptions'] {
  const f = v2.apiFeatures
  return {
    isNotSupportArrayContent: !f.arrayContent,
    isNotSupportStreamOptions: !f.streamOptions,
    isSupportDeveloperRole: f.developerRole,
    isNotSupportDeveloperRole: !f.developerRole,
    isSupportServiceTier: f.serviceTier,
    isNotSupportServiceTier: !f.serviceTier,
    isNotSupportVerbosity: !f.verbosity,
    isNotSupportEnableThinking: !f.enableThinking
  }
}

/**
 * Bridge runtime/Data API Model shape to the legacy renderer `Model` shape for
 * downstream code that still depends on `model.provider`.
 */
export function toV1ModelShim(v2: V2Model): V1Model {
  const apiId = v2.apiModelId?.trim() || (isUniqueModelId(v2.id) ? parseUniqueModelId(v2.id).modelId : v2.id)

  return {
    id: apiId,
    provider: v2.providerId,
    name: v2.name,
    group: v2.group ?? '',
    owned_by: v2.ownedBy,
    description: v2.description,
    endpoint_type: v2.endpointTypes?.[0],
    supported_endpoint_types: v2.endpointTypes
  } as V1Model
}

/** Use before `checkApi` calls that still expect a v1 `Model`: return v1 as-is, otherwise bridge via {@link toV1ModelShim}. */
export function toV1ModelForCheckApi(model: unknown): V1Model {
  if (
    typeof model === 'object' &&
    model !== null &&
    'provider' in model &&
    typeof (model as { provider?: unknown }).provider === 'string'
  ) {
    return model as V1Model
  }
  return toV1ModelShim(model as V2Model)
}

/**
 * Bridge runtime/Data API Provider shape to the legacy renderer `Provider`
 * shape as a temporary compatibility layer for old aiCore / ApiService flows.
 */
export function toV1ProviderShim(v2Provider: V2Provider, options: V1ShimOptions = {}): V1Provider {
  const cache = v2Provider.settings?.cacheControl
  const anthropicCacheControl =
    cache != null
      ? {
          tokenThreshold: cache.tokenThreshold ?? 0,
          cacheSystemMessage: cache.cacheSystemMessage ?? false,
          cacheLastNMessages: cache.cacheLastNMessages ?? 0
        }
      : undefined

  return {
    id: v2Provider.id,
    name: v2Provider.name,
    type: v1ProviderTypeFromV2(v2Provider),
    apiKey: options.apiKey ?? '',
    apiHost: options.apiHost ?? defaultChatBaseUrl(v2Provider),
    anthropicApiHost: v2Provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl,
    models: (options.models ?? []) as unknown as V1Model[],
    enabled: v2Provider.isEnabled,
    isSystem: v2Provider.presetProviderId != null,
    rateLimit: v2Provider.settings?.rateLimit,
    apiVersion: v2Provider.settings?.apiVersion,
    serviceTier: v2Provider.settings?.serviceTier as V1Provider['serviceTier'],
    verbosity: v2Provider.settings?.verbosity as V1Provider['verbosity'],
    apiOptions: apiFeaturesToApiOptions(v2Provider),
    anthropicCacheControl,
    notes: v2Provider.settings?.notes,
    extra_headers: v2Provider.settings?.extraHeaders
  } as V1Provider
}
