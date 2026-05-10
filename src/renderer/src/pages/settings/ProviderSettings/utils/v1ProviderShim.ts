// TODO(v2-cleanup): Phase 5 迁移完成后删除此文件
// 将 v2 DataApi Provider 桥接为 v1 Provider 形状，供尚未迁移的下游使用。

import type { Model as V1Model, Provider as V1Provider, ProviderType } from '@renderer/types'
import type { Model as V2Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider as V2Provider } from '@shared/data/types/provider'

export interface V1ShimOptions {
  /** 来自 useModels()（v2 Model 与 v1 在运行时可互操作） */
  models?: V2Model[]
  /** 来自 useProviderApiKeys() keys join(',') 或表单本地 key */
  apiKey?: string
  /** 覆盖 baseUrls 推导，例如表单中的 apiHost */
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
  if (v2.authType === 'iam-aws') {
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
 * 将 v2 DataApi Model 桥接为 v1 Model 形状，供 AiProvider / checkApi 等仍依赖 `model.provider` 的代码使用。
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

/** 调用仍基于 v1 `Model` 的 `checkApi` 前使用：已是 v1 则原样返回，否则走 {@link toV1ModelShim}。 */
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
 * 将 v2 Provider 桥接为 v1 Provider 形状（临时过渡层）。
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
