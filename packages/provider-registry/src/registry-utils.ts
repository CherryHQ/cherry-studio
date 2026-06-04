/**
 * Pure registry utilities — no fs or Node.js dependency.
 * Safe to import from browser/renderer contexts.
 */

import { ENDPOINT_TYPE, type EndpointType } from './schemas/enums'
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

export interface RuntimeEndpointConfig {
  baseUrl?: string
  modelsApiUrls?: { default?: string; embedding?: string; reranker?: string }
  reasoningFormatType?: string
  adapterFamily?: string
}

/**
 * Convert registry endpointConfigs (with reasoningFormat discriminated union)
 * to runtime endpointConfigs (with reasoningFormatType string).
 */
export function buildRuntimeEndpointConfigs(
  registryConfigs: Record<string, RegistryEndpointConfig> | undefined
): Record<string, RuntimeEndpointConfig> | null {
  if (!registryConfigs || Object.keys(registryConfigs).length === 0) return null

  const configs: Record<string, RuntimeEndpointConfig> = {}

  for (const [k, regConfig] of Object.entries(registryConfigs)) {
    const config: RuntimeEndpointConfig = {}

    if (regConfig.baseUrl) config.baseUrl = regConfig.baseUrl
    if (regConfig.modelsApiUrls) config.modelsApiUrls = regConfig.modelsApiUrls
    if (regConfig.reasoningFormat?.type) config.reasoningFormatType = regConfig.reasoningFormat.type
    if (regConfig.adapterFamily) config.adapterFamily = regConfig.adapterFamily

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
  catalogConfig?: Pick<RegistryEndpointConfig, 'adapterFamily'> | Pick<RuntimeEndpointConfig, 'adapterFamily'> | null
): string {
  if (catalogConfig?.adapterFamily) return catalogConfig.adapterFamily
  return ENDPOINT_TYPE_TO_DEFAULT_ADAPTER_FAMILY[endpointType] ?? 'openai-compatible'
}
