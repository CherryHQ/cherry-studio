/**
 * Pure registry utilities — no fs or Node.js dependency.
 * Safe to import from browser/renderer contexts.
 */

import { ModelIndex, ProviderModelIndex } from './registry-index'
import { ENDPOINT_TYPE, type EndpointType, MODEL_CAPABILITY, type ModelCapability } from './schemas/enums'
import type { ModelConfig } from './schemas/model'
import type { EndpointDialect, ProviderConfig, RegistryEndpointConfig } from './schemas/provider'
import type { ProviderModelOverride } from './schemas/provider-models'

export interface ModelLookupResult {
  presetModel: ModelConfig | null
  registryOverride: ProviderModelOverride | null
}

/**
 * Look up a model's preset data and provider-specific override from loaded registry data.
 * Pure function — no caching, no side effects.
 */
export function lookupRegistryModel(
  models: ModelConfig[],
  providerModels: ProviderModelOverride[],
  providerId: string,
  modelId: string
): ModelLookupResult {
  const registryOverride = new ProviderModelIndex(providerModels).findOverride(providerId, modelId)
  const presetModel = new ModelIndex(models).findModel(registryOverride?.modelId ?? modelId)
  return { presetModel, registryOverride }
}

/**
 * Find a provider config by ID from loaded registry data.
 */
export function lookupRegistryProvider(providers: ProviderConfig[], providerId: string): ProviderConfig | null {
  return providers.find((p) => p.id === providerId) ?? null
}

export interface PersistedEndpointConfig {
  baseUrl?: string
  modelsApiUrls?: { default?: string; embedding?: string; image?: string; reranker?: string }
  adapterFamily?: string
  dialect?: EndpointDialect
}

function wireCarriesReasoningSummary(config: RegistryEndpointConfig): boolean {
  const wire = config.reasoningFormat?.wire
  if (!wire || wire.disabled) return false
  return [wire.default, wire.auto, wire.effort].some((mode) =>
    mode?.operations.some((operation) => operation.value.source === 'assistant-summary')
  )
}

/**
 * Project registry endpoint configs onto the connection facts persisted in
 * user_provider. Main-only reasoning profiles deliberately stay in registry
 * memory and never cross this boundary.
 */
export function buildPersistedEndpointConfigs(
  registryConfigs: Record<string, RegistryEndpointConfig> | undefined
): Record<string, PersistedEndpointConfig> | null {
  if (!registryConfigs || Object.keys(registryConfigs).length === 0) return null

  const configs: Record<string, PersistedEndpointConfig> = {}

  for (const [k, regConfig] of Object.entries(registryConfigs)) {
    const config: PersistedEndpointConfig = {}

    if (regConfig.baseUrl) config.baseUrl = regConfig.baseUrl
    if (regConfig.modelsApiUrls) config.modelsApiUrls = regConfig.modelsApiUrls
    if (regConfig.adapterFamily) config.adapterFamily = regConfig.adapterFamily
    const dialect = { ...regConfig.dialect }
    // Renderer-safe projection of the main-only wire, so a preset's effective
    // switch state can be displayed and overridden without exposing the wire.
    if (dialect.reasoningSummary === undefined && wireCarriesReasoningSummary(regConfig)) {
      dialect.reasoningSummary = true
    }
    if (Object.keys(dialect).length > 0) config.dialect = dialect

    if (Object.keys(config).length > 0) configs[k] = config
  }

  return Object.keys(configs).length > 0 ? configs : null
}

/**
 * Default AI SDK adapter family per endpoint type. Used when the catalog
 * doesn't specify one and no more-specific signal (e.g. legacy provider type)
 * is available. The mapping is purely protocol-derived — any endpoint that
 * speaks anthropic-messages format needs the `anthropic` adapter, etc.
 */
const ENDPOINT_TYPE_TO_DEFAULT_ADAPTER_FAMILY: Partial<Record<EndpointType, string>> = {
  [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'anthropic',
  [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: 'google',
  [ENDPOINT_TYPE.OLLAMA_CHAT]: 'ollama',
  [ENDPOINT_TYPE.OLLAMA_GENERATE]: 'ollama',
  [ENDPOINT_TYPE.JINA_RERANK]: 'jina-rerank',
  [ENDPOINT_TYPE.OPENAI_RESPONSES]: 'openai'
}

/**
 * Compute the AI SDK adapter family for an endpoint. Single source of truth
 * for seeder / migrator / UI creation paths — `adapterFamily` is a derived,
 * write-time value; the runtime resolver only reads it.
 *
 *   1. Catalog `adapterFamily` wins when present (encodes vendor-specific
 *      relay routing like `aihubmix` for anthropic-messages on AiHubMix).
 *   2. Otherwise, fall back to the endpoint-type default
 *      (`anthropic-messages` → `anthropic`, etc.).
 *   3. Final fallback `openai-compatible` covers `openai-chat-completions`
 *      and any future openai-protocol endpoint without a more specific match.
 */
export function inferAdapterFamily(
  endpointType: EndpointType,
  catalogConfig?: Pick<RegistryEndpointConfig, 'adapterFamily'> | Pick<PersistedEndpointConfig, 'adapterFamily'> | null
): string {
  if (catalogConfig?.adapterFamily) return catalogConfig.adapterFamily
  return ENDPOINT_TYPE_TO_DEFAULT_ADAPTER_FAMILY[endpointType] ?? 'openai-compatible'
}

/** Connection-root compatibility, not wire-format compatibility. Order defines fallback priority. */
export const ENDPOINT_CONNECTION_FAMILY = {
  'openai-chat-completions': 'openai-compatible',
  'openai-responses': 'openai-compatible',
  'openai-text-completions': 'openai-compatible',
  'openai-image-generation': 'openai-compatible',
  'openai-image-edit': 'openai-compatible',
  'openai-embeddings': 'openai-compatible',
  'openai-text-to-speech': 'openai-compatible',
  'openai-audio-transcription': 'openai-compatible',
  'openai-audio-translation': 'openai-compatible',
  'openai-video-generation': 'openai-compatible',
  'jina-rerank': 'openai-compatible',
  'anthropic-messages': 'anthropic',
  'google-generate-content': 'google',
  'ollama-chat': 'ollama',
  'ollama-generate': 'ollama'
} as const satisfies Record<EndpointType, string>

/** New API additionally shares one gateway root across its explicitly declared protocols. */
export function canInheritEndpointConnection(
  target: EndpointType,
  source: EndpointType,
  targetConfig?: Pick<RegistryEndpointConfig, 'adapterFamily'>,
  sourceConfig?: Pick<RegistryEndpointConfig, 'adapterFamily'>
): boolean {
  return (
    ENDPOINT_CONNECTION_FAMILY[target] === ENDPOINT_CONNECTION_FAMILY[source] ||
    (targetConfig?.adapterFamily === 'newapi' && sourceConfig?.adapterFamily === 'newapi')
  )
}

export interface EndpointConnectionSource {
  defaultChatEndpoint?: EndpointType
  endpointConfigs?: Partial<Record<EndpointType, PersistedEndpointConfig>> | null
}

/** Selects a configured connection; URL normalization and request semantics remain caller-owned. */
export function resolveEndpointConnection(
  provider: EndpointConnectionSource,
  target: EndpointType | undefined
): { source: EndpointType; baseUrl: string } | undefined {
  if (!target) return undefined
  const configs = provider.endpointConfigs
  for (const source of [
    target,
    provider.defaultChatEndpoint,
    ...(Object.keys(ENDPOINT_CONNECTION_FAMILY) as EndpointType[])
  ]) {
    if (!source || !canInheritEndpointConnection(target, source, configs?.[target], configs?.[source])) continue
    const baseUrl = configs?.[source]?.baseUrl?.trim()
    if (baseUrl) return { source, baseUrl }
  }
  return undefined
}

/** Tasks served by native adapters through their configured connection endpoint. */
export function supportsNativeTask(adapterFamily: string | undefined, capability: ModelCapability): boolean {
  if (adapterFamily === 'voyage') {
    return capability === MODEL_CAPABILITY.EMBEDDING || capability === MODEL_CAPABILITY.RERANK
  }
  return adapterFamily === 'bedrock' && capability === MODEL_CAPABILITY.EMBEDDING
}

/** Suggestions are deployment-aware defaults, never replacements for explicit model endpoints. */
export function suggestModelEndpoints(
  provider: EndpointConnectionSource,
  model: Pick<ModelConfig, 'endpointTypes' | 'capabilities' | 'outputModalities'>,
  deploymentDefaultEndpoint?: EndpointType
): EndpointType[] | undefined {
  const taskOnly =
    (model.capabilities ?? []).some((capability) =>
      [MODEL_CAPABILITY.EMBEDDING, MODEL_CAPABILITY.RERANK].some((task) => task === capability)
    ) ||
    (model.outputModalities?.some((modality) => modality !== 'text') && !model.outputModalities?.includes('text'))
  const chatDefault = deploymentDefaultEndpoint ?? provider.defaultChatEndpoint
  if (!taskOnly && chatDefault) return [chatDefault]
  const nativeEndpoint = provider.defaultChatEndpoint
  if (
    nativeEndpoint &&
    (model.capabilities ?? []).some((capability) =>
      supportsNativeTask(provider.endpointConfigs?.[nativeEndpoint]?.adapterFamily, capability)
    ) &&
    resolveEndpointConnection(provider, nativeEndpoint)
  )
    return [nativeEndpoint]
  const declared = model.endpointTypes?.filter((endpoint) => resolveEndpointConnection(provider, endpoint))
  if (declared?.length) return declared
  const defaultEndpoint = provider.defaultChatEndpoint
  const capabilities = model.capabilities ?? []
  let candidates: EndpointType[]
  if (capabilities.includes(MODEL_CAPABILITY.EMBEDDING)) {
    candidates = [ENDPOINT_TYPE.OPENAI_EMBEDDINGS, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, ENDPOINT_TYPE.OLLAMA_CHAT]
  } else if (capabilities.includes(MODEL_CAPABILITY.RERANK)) {
    candidates = [ENDPOINT_TYPE.JINA_RERANK]
  } else if (
    capabilities.includes(MODEL_CAPABILITY.AUDIO_GENERATION) &&
    model.outputModalities?.length === 1 &&
    model.outputModalities[0] === 'audio'
  ) {
    candidates = model.endpointTypes?.length
      ? []
      : [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, ENDPOINT_TYPE.OPENAI_TEXT_TO_SPEECH]
  } else if (capabilities.includes(MODEL_CAPABILITY.IMAGE_GENERATION) && !model.outputModalities?.includes('text')) {
    candidates = [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]
  } else {
    return defaultEndpoint ? [defaultEndpoint] : undefined
  }
  const compatible = candidates.filter((endpoint) => resolveEndpointConnection(provider, endpoint))
  const preferred = defaultEndpoint && compatible.includes(defaultEndpoint) ? defaultEndpoint : compatible[0]
  return preferred ? [preferred] : undefined
}

/**
 * Capability-exclusive endpoints imply a model capability: a model whose primary
 * endpoint is `jina-rerank` can only rerank, `openai-embeddings` can only embed,
 * and dedicated image/audio/video endpoints can only serve their named media task.
 * Single source of truth for deriving a capability from a model's endpoint when
 * the catalog has no entry for it (e.g. opaque gateway/NewAPI model ids).
 * Chat/completions endpoints are general-purpose and imply nothing, so they're
 * absent from the map.
 */
const ENDPOINT_IMPLIED_CAPABILITY: Partial<Record<EndpointType, ModelCapability>> = {
  [ENDPOINT_TYPE.JINA_RERANK]: MODEL_CAPABILITY.RERANK,
  [ENDPOINT_TYPE.OPENAI_AUDIO_TRANSCRIPTION]: MODEL_CAPABILITY.AUDIO_TRANSCRIPT,
  [ENDPOINT_TYPE.OPENAI_AUDIO_TRANSLATION]: MODEL_CAPABILITY.AUDIO_TRANSCRIPT,
  [ENDPOINT_TYPE.OPENAI_EMBEDDINGS]: MODEL_CAPABILITY.EMBEDDING,
  [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: MODEL_CAPABILITY.IMAGE_GENERATION,
  [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: MODEL_CAPABILITY.IMAGE_GENERATION,
  [ENDPOINT_TYPE.OPENAI_TEXT_TO_SPEECH]: MODEL_CAPABILITY.AUDIO_GENERATION,
  [ENDPOINT_TYPE.OPENAI_VIDEO_GENERATION]: MODEL_CAPABILITY.VIDEO_GENERATION
}

/** Capability implied by a capability-exclusive endpoint, or `undefined` for general-purpose endpoints. */
export function endpointImpliedCapability(endpointType: EndpointType | undefined | null): ModelCapability | undefined {
  return endpointType ? ENDPOINT_IMPLIED_CAPABILITY[endpointType] : undefined
}

/** Finite speech synthesis supported by declared endpoints and modalities, independent of model IDs. */
export function getSpeechGenerationEndpoint(
  model: Pick<ModelConfig, 'endpointTypes' | 'inputModalities' | 'outputModalities'>
): EndpointType | undefined {
  if (model.endpointTypes?.includes(ENDPOINT_TYPE.OPENAI_TEXT_TO_SPEECH)) {
    return ENDPOINT_TYPE.OPENAI_TEXT_TO_SPEECH
  }
  if (
    model.endpointTypes?.includes(ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) &&
    model.inputModalities?.length === 1 &&
    model.inputModalities[0] === 'text' &&
    model.outputModalities?.length === 1 &&
    model.outputModalities[0] === 'audio'
  ) {
    return ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
  }
  return undefined
}

/** New API advertises OpenAI TTS as generic `openai`; the catalog supplies its speech dialect. */
export function getNewApiSpeechEndpoint(
  model: Pick<ModelConfig, 'endpointTypes' | 'inputModalities' | 'outputModalities'>,
  catalogModel: ModelConfig | null
): EndpointType | undefined {
  if (
    getSpeechGenerationEndpoint(catalogModel ?? {}) === ENDPOINT_TYPE.OPENAI_TEXT_TO_SPEECH &&
    (!model.endpointTypes?.length || model.endpointTypes.includes(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS))
  ) {
    return ENDPOINT_TYPE.OPENAI_TEXT_TO_SPEECH
  }
  return getSpeechGenerationEndpoint(model)
}
