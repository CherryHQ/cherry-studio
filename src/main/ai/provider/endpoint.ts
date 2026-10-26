/**
 * Endpoint + AI SDK provider id resolution. See
 * `docs/references/ai/adapter-family.md` for design rationale.
 */

import { supportsNativeTask } from '@cherrystudio/provider-registry'
import { resolveEndpointBaseUrl } from '@main/ai/provider/endpointConnection'
import { selectChatEndpoint } from '@shared/ai/modelEndpoint'
import { LOCAL_EMBEDDING_PROVIDER_ID } from '@shared/data/presets/localEmbedding'
import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, MODEL_CAPABILITY, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { getRawModelId } from '@shared/utils/model'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

import { type AppProviderId, appProviderIds } from '../types'
import { extensions } from './extensions'
import type { LanguageModelAdapter } from './languageModelAdapter'

export interface ResolvedEndpoint {
  /** `undefined` when neither model nor provider declares an endpoint. */
  endpointType: EndpointType | undefined
  /** Empty string when no config matched. */
  baseUrl: string
  /** Executable adapter and its parameter namespace, supplied by the provider extension. */
  languageModelAdapter?: LanguageModelAdapter
}

/**
 * The model id as it must appear on the wire.
 *
 * Gemini's `/models` listing names models `models/<id>`; the prefix is stripped at
 * ingestion today, but rows synced before that still carry it. Both forms build the
 * same request URL, so the difference is invisible — except that `@ai-sdk/google`
 * matches its feature allowlists (googleSearch, urlContext, code execution, …)
 * against the id EXACTLY, so a prefixed id silently drops those tools from the
 * request. Normalise once here rather than teaching every consumer about it.
 */
export function resolveWireModelId(model: Model, endpointType: EndpointType | undefined): string {
  const rawId = getRawModelId(model)
  return endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT ? rawId.replace(/^models\//, '') : rawId
}

/**
 * Priority: usable preference → model primary → gateway route → provider default.
 * Preferences must be model-supported and resolve a connection within the same family.
 */
export function resolveEffectiveEndpoint(
  provider: Provider,
  model: Model,
  preferredEndpointType?: EndpointType
): ResolvedEndpoint {
  const endpointType = selectChatEndpoint(provider, model, preferredEndpointType)
  const languageModelAdapter = resolveLanguageModelAdapter(
    endpointType ? provider.endpointConfigs?.[endpointType]?.adapterFamily : undefined,
    endpointType,
    model.apiModelId ?? model.id
  )
  return { endpointType, baseUrl: resolveEndpointBaseUrl(provider, endpointType), languageModelAdapter }
}

/** Provider-specific execution is registered beside the provider factory. */
export function resolveLanguageModelAdapter(
  providerId: string | undefined,
  endpointType: EndpointType | undefined,
  modelId: string
): LanguageModelAdapter | undefined {
  const config = extensions.find((extension) => providerId && extension.hasProviderId(providerId))?.config
  return config && 'resolveLanguageModelAdapter' in config
    ? config.resolveLanguageModelAdapter(endpointType, modelId)
    : undefined
}

export type ModelRequestKind = 'image' | 'image-edit' | 'embedding' | 'speech' | 'rerank'

/** Select the target before constructing SDK settings, without changing the model's chat ordering. */
export function resolveRequestEndpoint(provider: Provider, model: Model, kind: ModelRequestKind): ResolvedEndpoint {
  const endpoint = findRequestEndpoint(provider, model, kind)
  if (!endpoint) throw new Error(`Model ${model.id} has no endpoint for ${kind}`)
  return endpoint
}

/** The same request routing used by execution, with unsupported models omitted during discovery. */
export function findRequestEndpoint(
  provider: Provider,
  model: Model,
  kind: ModelRequestKind
): ResolvedEndpoint | undefined {
  if (provider.id === LOCAL_EMBEDDING_PROVIDER_ID && kind === 'embedding') {
    return { endpointType: undefined, baseUrl: '' }
  }
  const dedicated: Record<ModelRequestKind, EndpointType[]> = {
    image: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION],
    'image-edit': [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT, ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION],
    embedding: [ENDPOINT_TYPE.OPENAI_EMBEDDINGS],
    speech: [ENDPOINT_TYPE.OPENAI_TEXT_TO_SPEECH],
    rerank: [ENDPOINT_TYPE.JINA_RERANK]
  }
  const capability = {
    image: MODEL_CAPABILITY.IMAGE_GENERATION,
    'image-edit': MODEL_CAPABILITY.IMAGE_GENERATION,
    embedding: MODEL_CAPABILITY.EMBEDDING,
    speech: MODEL_CAPABILITY.AUDIO_GENERATION,
    rerank: MODEL_CAPABILITY.RERANK
  }[kind]
  const declared = model.endpointTypes?.length
    ? model.endpointTypes
    : [resolveEffectiveEndpoint(provider, model).endpointType].filter((ep): ep is EndpointType => !!ep)
  const general = declared.filter((ep) => {
    if (!model.capabilities.includes(capability)) return false
    if (supportsNativeTask(provider.endpointConfigs?.[ep]?.adapterFamily, capability)) return true
    if (kind === 'speech') {
      return (
        ep === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT &&
        model.inputModalities?.length === 1 &&
        model.inputModalities[0] === 'text' &&
        model.outputModalities?.length === 1 &&
        model.outputModalities[0] === 'audio'
      )
    }
    return [
      ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
      ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      ENDPOINT_TYPE.OPENAI_RESPONSES,
      ENDPOINT_TYPE.OLLAMA_CHAT,
      ENDPOINT_TYPE.OLLAMA_GENERATE
    ].some((candidate) => candidate === ep)
  })
  const applicable = declared.filter(
    (ep) => dedicated[kind].includes(ep) || (ep === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT && general.includes(ep))
  )
  const endpointType =
    (kind === 'image-edit' && declared.includes(ENDPOINT_TYPE.OPENAI_IMAGE_EDIT)
      ? ENDPOINT_TYPE.OPENAI_IMAGE_EDIT
      : applicable[0]) ?? general[0]
  if (!endpointType) return undefined
  return resolveEffectiveEndpoint(provider, { ...model, endpointTypes: [endpointType] })
}

/** Maps base id → variant id (`openai` + `openai-chat-completions` → `openai-chat`). No-op when no variant exists. */
export function resolveProviderVariant(
  baseProviderId: AppProviderId,
  endpointType: EndpointType | undefined
): AppProviderId {
  if (!endpointType) return baseProviderId

  if (endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS || endpointType === ENDPOINT_TYPE.OLLAMA_CHAT) {
    const chatVariant = `${baseProviderId}-chat`
    if (chatVariant in appProviderIds) return appProviderIds[chatVariant]
  }

  if (endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES) {
    const responsesVariant = `${baseProviderId}-responses`
    if (responsesVariant in appProviderIds) return appProviderIds[responsesVariant]
  }

  return baseProviderId
}

export function resolveAiSdkProviderId(provider: Provider, endpointType: EndpointType | undefined): AppProviderId {
  const adapterFamily = endpointType ? provider.endpointConfigs?.[endpointType]?.adapterFamily : undefined
  if (adapterFamily && adapterFamily in appProviderIds) {
    return resolveProviderVariant(appProviderIds[adapterFamily], endpointType)
  }
  if (endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES) {
    return appProviderIds['open-responses']
  }
  return appProviderIds['openai-compatible']
}

/**
 * Maps the registered runtime provider id to the namespace its AI SDK model
 * reads from `providerOptions`.
 */
export function resolveProviderOptionsKey(
  providerId: AppProviderId,
  context?: {
    actualProviderId?: string
    endpointType?: EndpointType
  }
): string {
  switch (providerId) {
    // open-responses included: `createOpenResponses({ name: 'openai' })` keeps
    // the wire namespace 'openai'.
    case 'openai':
    case 'openai-chat':
    case 'azure':
    case 'azure-responses':
    case 'huggingface':
    case 'open-responses':
      return 'openai'
    case 'anthropic':
    case 'azure-anthropic':
      return 'anthropic'
    case 'google':
      return 'google'
    case 'google-vertex':
    case 'google-vertex-anthropic':
    case 'google-vertex-maas':
      return 'vertex'
    case 'xai':
    case 'xai-responses':
      return 'xai'
    case 'bedrock':
      return 'bedrock'
    case SystemProviderIds.ollama:
      return 'ollama'
    case 'github-copilot-openai-compatible':
    case 'openai-compatible':
      return context?.actualProviderId ?? providerId
    case 'cherryin':
    case 'cherryin-chat':
    case 'newapi':
    case SystemProviderIds.gateway:
      if (context?.endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES) return 'anthropic'
      if (context?.endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) return 'google'
      if (context?.endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES) return 'openai'
      return providerId
    default:
      return providerId
  }
}

/**
 * Single derivation of the providerOptions namespace for a resolved endpoint:
 * adapter id via {@link resolveAiSdkProviderId}, then its namespace via
 * {@link resolveProviderOptionsKey}. Gateway consumers must use this instead of
 * composing the two calls themselves so reasoning options and other
 * provider-option writers can never disagree on the namespace.
 */
export function resolveEndpointProviderOptionsKey(provider: Provider, resolvedEndpoint: ResolvedEndpoint): string {
  return (
    resolvedEndpoint.languageModelAdapter?.providerOptionsKey ??
    resolveProviderOptionsKey(resolveAiSdkProviderId(provider, resolvedEndpoint.endpointType), {
      actualProviderId: provider.id,
      endpointType: resolvedEndpoint.endpointType
    })
  )
}
