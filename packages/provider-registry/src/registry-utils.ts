/**
 * Pure registry utilities — no fs or Node.js dependency.
 * Safe to import from browser/renderer contexts.
 */

import { ENDPOINT_TYPE, type EndpointType, MODEL_CAPABILITY, type ModelCapability } from './schemas/enums'
import type { ModelConfig } from './schemas/model'
import type { ProviderConfig, RegistryEndpointConfig } from './schemas/provider'
import type { ProviderModelOverride } from './schemas/provider-models'
import { normalizeModelId } from './utils/normalize'

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
  // Exact match first, then normalized fallback
  let presetModel = models.find((m) => m.id === modelId) ?? null
  if (!presetModel) {
    const normalizedId = normalizeModelId(modelId)
    presetModel = models.find((m) => normalizeModelId(m.id) === normalizedId) ?? null
  }

  let registryOverride = providerModels.find((pm) => pm.providerId === providerId && pm.modelId === modelId) ?? null
  if (!registryOverride) {
    const normalizedId = normalizeModelId(modelId)
    registryOverride =
      providerModels.find((pm) => pm.providerId === providerId && normalizeModelId(pm.modelId) === normalizedId) ?? null
  }

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
  serves?: { pattern: string; except?: string }
  providerOptionsKey?: string
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
    // Per-model dispatch travels with the endpoint that declares it — dropping it here is what
    // silently demoted every routed model to `defaultChatEndpoint`.
    if (regConfig.serves) config.serves = regConfig.serves
    if (regConfig.providerOptionsKey) config.providerOptionsKey = regConfig.providerOptionsKey

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

// ═══════════════════════════════════════════════════════════════════════════════
// Per-model endpoint dispatch
// ═══════════════════════════════════════════════════════════════════════════════

/** The subset of an endpoint's config this dispatch reads. */
export interface EndpointDispatchConfig {
  /** Which ids this endpoint serves instead of the provider default. */
  serves?: { pattern: string; except?: string }
  /** Namespace override for the AI SDK class behind this endpoint. */
  providerOptionsKey?: string
}

const regexCache = new Map<string, RegExp>()
function ruleRegex(pattern: string): RegExp {
  let regex = regexCache.get(pattern)
  if (!regex) {
    regex = new RegExp(pattern, 'i')
    regexCache.set(pattern, regex)
  }
  return regex
}

/** A resolved dispatch: the endpoint claiming this model, plus that endpoint's namespace override. */
export interface ResolvedModelRoute {
  endpointType: EndpointType
  providerOptionsKey?: string
}

/** Which endpoint a (provider, model) pair uses, and the namespace that endpoint's SDK class reads. */
export interface ResolvedModelEndpoint {
  endpointType: EndpointType | undefined
  /** Set only when the claiming endpoint is the one actually used AND overrides the namespace. */
  providerOptionsKey: string | undefined
}

/**
 * The endpoint whose `serves` claims this model id, or `undefined` when none does — callers fall
 * back to the provider's `defaultChatEndpoint` (and its own provider-options namespace), which is
 * what a gateway's passthrough line is.
 *
 * Claims are written to be mutually exclusive, so iteration order carries no meaning: an id two
 * endpoints could both take is a bug in the data, not a precedence question.
 */
export function resolveProviderModelRoute(
  endpointConfigs: Partial<Record<EndpointType, EndpointDispatchConfig>> | undefined,
  modelId: string | undefined
): ResolvedModelRoute | undefined {
  if (!endpointConfigs || !modelId) return undefined

  for (const [endpointType, config] of Object.entries(endpointConfigs)) {
    const serves = config?.serves
    if (!serves || !ruleRegex(serves.pattern).test(modelId)) continue
    if (serves.except && ruleRegex(serves.except).test(modelId)) continue
    return { endpointType: endpointType as EndpointType, providerOptionsKey: config.providerOptionsKey }
  }
  return undefined
}

export interface ModelEndpointInput {
  /** Endpoints the model itself declares — a catalog override, or the provider's own `/models` list. */
  endpointTypes?: readonly EndpointType[]
  /** The provider's endpoints, each declaring which creators it serves. */
  endpointConfigs?: Partial<Record<EndpointType, EndpointDispatchConfig>>
  /** Raw api model id — what each endpoint's `serves` pattern matches against. */
  modelId?: string
  defaultChatEndpoint?: EndpointType | null
  /** Narrows which endpoints may be picked at all — e.g. "must be able to carry reasoning". */
  accept?: (endpointType: EndpointType) => boolean
}

/**
 * Which endpoint a (provider, model) pair uses — **the** answer, in one place.
 *
 * Priority: the model's own declaration → the endpoint claiming the id → the provider default.
 * Request routing and the catalog's reasoning projection both resolve through this; when they
 * disagreed, the renderer offered a vocabulary the wire never spoke (#17900). A per-SKU exception
 * (an OpenAI model with no Responses support) is expressed as the model's own `endpointTypes`, which
 * takes the first slot, or as the claiming endpoint's `except`.
 */
export function resolveModelEndpoint(input: ModelEndpointInput): ResolvedModelEndpoint {
  const accept = input.accept ?? (() => true)

  const declared = input.endpointTypes?.find(accept)
  const match = resolveProviderModelRoute(input.endpointConfigs, input.modelId)
  const route = match && accept(match.endpointType) ? match : undefined
  const fallback =
    input.defaultChatEndpoint && accept(input.defaultChatEndpoint) ? input.defaultChatEndpoint : undefined
  const endpointType = declared ?? route?.endpointType ?? fallback

  // The claim's namespace applies only if the claim actually won: a model that declares its own
  // endpoint overrides the claim, and inheriting the loser's namespace would address the request to
  // an SDK class it never reaches.
  return {
    endpointType,
    providerOptionsKey: route && endpointType === route.endpointType ? route.providerOptionsKey : undefined
  }
}
