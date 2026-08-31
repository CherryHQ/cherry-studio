/**
 * Pure registry utilities — no fs or Node.js dependency.
 * Safe to import from browser/renderer contexts.
 */

import { ENDPOINT_TYPE, type EndpointType, MODEL_CAPABILITY, type ModelCapability } from './schemas/enums'
import type { ModelConfig } from './schemas/model'
import type { EndpointDialect, ProviderConfig, RegistryEndpointConfig } from './schemas/provider'
import type { ProviderModelOverride } from './schemas/provider-models'
import { normalizeModelId } from './utils/normalize'

export interface ModelLookupResult {
  presetModel: ModelConfig | null
  registryOverride: ProviderModelOverride | null
}

export function applyModelCapabilityOverride(
  baseCapabilities: readonly ModelCapability[],
  override: ProviderModelOverride['capabilities']
): ModelCapability[] {
  if (!override) return [...baseCapabilities]
  if (override.force) return [...new Set(override.force)]

  const removed = new Set(override.remove ?? [])
  return [...new Set([...baseCapabilities, ...(override.add ?? [])])].filter((capability) => !removed.has(capability))
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

export const MODEL_OPERATION_CAPABILITIES = [
  MODEL_CAPABILITY.TEXT_GENERATION,
  MODEL_CAPABILITY.EMBEDDING,
  MODEL_CAPABILITY.RERANK,
  MODEL_CAPABILITY.IMAGE_GENERATION,
  MODEL_CAPABILITY.AUDIO_TRANSCRIPT,
  MODEL_CAPABILITY.AUDIO_GENERATION,
  MODEL_CAPABILITY.VIDEO_GENERATION
] as const satisfies readonly ModelCapability[]

export type ModelOperationCapability = (typeof MODEL_OPERATION_CAPABILITIES)[number]

interface EndpointOperationContract {
  defaultOperation: ModelOperationCapability
  allowedOperations: readonly ModelOperationCapability[]
}

/** Operation semantics for every wire endpoint supported by the registry. */
export const ENDPOINT_OPERATION_CONTRACT = {
  [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
    defaultOperation: MODEL_CAPABILITY.TEXT_GENERATION,
    allowedOperations: [MODEL_CAPABILITY.TEXT_GENERATION]
  },
  [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
    defaultOperation: MODEL_CAPABILITY.TEXT_GENERATION,
    allowedOperations: [MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.IMAGE_GENERATION]
  },
  [ENDPOINT_TYPE.JINA_RERANK]: {
    defaultOperation: MODEL_CAPABILITY.RERANK,
    allowedOperations: [MODEL_CAPABILITY.RERANK]
  },
  [ENDPOINT_TYPE.OLLAMA_CHAT]: {
    defaultOperation: MODEL_CAPABILITY.TEXT_GENERATION,
    allowedOperations: [MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.EMBEDDING]
  },
  [ENDPOINT_TYPE.OLLAMA_GENERATE]: {
    defaultOperation: MODEL_CAPABILITY.TEXT_GENERATION,
    allowedOperations: [MODEL_CAPABILITY.TEXT_GENERATION, MODEL_CAPABILITY.IMAGE_GENERATION]
  },
  [ENDPOINT_TYPE.OPENAI_AUDIO_TRANSCRIPTION]: {
    defaultOperation: MODEL_CAPABILITY.AUDIO_TRANSCRIPT,
    allowedOperations: [MODEL_CAPABILITY.AUDIO_TRANSCRIPT]
  },
  [ENDPOINT_TYPE.OPENAI_AUDIO_TRANSLATION]: {
    defaultOperation: MODEL_CAPABILITY.AUDIO_TRANSCRIPT,
    allowedOperations: [MODEL_CAPABILITY.AUDIO_TRANSCRIPT]
  },
  [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
    defaultOperation: MODEL_CAPABILITY.TEXT_GENERATION,
    allowedOperations: [MODEL_CAPABILITY.TEXT_GENERATION]
  },
  [ENDPOINT_TYPE.OPENAI_EMBEDDINGS]: {
    defaultOperation: MODEL_CAPABILITY.EMBEDDING,
    allowedOperations: [MODEL_CAPABILITY.EMBEDDING]
  },
  [ENDPOINT_TYPE.OPENAI_IMAGE_EDIT]: {
    defaultOperation: MODEL_CAPABILITY.IMAGE_GENERATION,
    allowedOperations: [MODEL_CAPABILITY.IMAGE_GENERATION]
  },
  [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: {
    defaultOperation: MODEL_CAPABILITY.IMAGE_GENERATION,
    allowedOperations: [MODEL_CAPABILITY.IMAGE_GENERATION]
  },
  [ENDPOINT_TYPE.OPENAI_RESPONSES]: {
    defaultOperation: MODEL_CAPABILITY.TEXT_GENERATION,
    allowedOperations: [MODEL_CAPABILITY.TEXT_GENERATION]
  },
  [ENDPOINT_TYPE.OPENAI_TEXT_COMPLETIONS]: {
    defaultOperation: MODEL_CAPABILITY.TEXT_GENERATION,
    allowedOperations: [MODEL_CAPABILITY.TEXT_GENERATION]
  },
  [ENDPOINT_TYPE.OPENAI_TEXT_TO_SPEECH]: {
    defaultOperation: MODEL_CAPABILITY.AUDIO_GENERATION,
    allowedOperations: [MODEL_CAPABILITY.AUDIO_GENERATION]
  },
  [ENDPOINT_TYPE.OPENAI_VIDEO_GENERATION]: {
    defaultOperation: MODEL_CAPABILITY.VIDEO_GENERATION,
    allowedOperations: [MODEL_CAPABILITY.VIDEO_GENERATION]
  }
} as const satisfies Record<EndpointType, EndpointOperationContract>

export type EndpointTypeForOperation<C extends ModelOperationCapability> = {
  [K in EndpointType]: C extends (typeof ENDPOINT_OPERATION_CONTRACT)[K]['allowedOperations'][number] ? K : never
}[EndpointType]

export interface ModelEndpointContractInput {
  capabilities?: readonly ModelCapability[]
  endpointTypes?: readonly EndpointType[]
  preferredEndpointType?: EndpointType
}

export function isModelOperationCapability(capability: ModelCapability): capability is ModelOperationCapability {
  return (MODEL_OPERATION_CAPABILITIES as readonly ModelCapability[]).includes(capability)
}

export function getModelOperationCapabilities(
  capabilities: readonly ModelCapability[] | undefined
): ModelOperationCapability[] {
  return capabilities?.filter(isModelOperationCapability) ?? []
}

export function endpointDefaultOperationCapability(
  endpointType: EndpointType | undefined | null
): ModelOperationCapability | undefined {
  return endpointType ? ENDPOINT_OPERATION_CONTRACT[endpointType].defaultOperation : undefined
}

export function endpointAllowedOperationCapabilities(endpointType: EndpointType): readonly ModelOperationCapability[] {
  return ENDPOINT_OPERATION_CONTRACT[endpointType].allowedOperations
}

export function isEndpointCompatibleWithOperation(
  endpointType: EndpointType,
  operationCapability: ModelOperationCapability
): boolean {
  return ENDPOINT_OPERATION_CONTRACT[endpointType].allowedOperations.some(
    (operation) => operation === operationCapability
  )
}

export function getModelEndpointContractIssues(model: ModelEndpointContractInput): string[] {
  const issues: string[] = []
  const operations = getModelOperationCapabilities(model.capabilities)

  if (operations.length === 0) issues.push('Model must declare at least one operation capability')

  for (const endpointType of model.endpointTypes ?? []) {
    if (!operations.some((operation) => isEndpointCompatibleWithOperation(endpointType, operation))) {
      issues.push(`Endpoint '${endpointType}' is incompatible with the model operation capabilities`)
    }
  }

  const preference = model.preferredEndpointType
  if (preference) {
    if (!model.endpointTypes?.includes(preference)) {
      issues.push(`Preferred endpoint '${preference}' must be declared by the model`)
    }
    if (!operations.some((operation) => isEndpointCompatibleWithOperation(preference, operation))) {
      issues.push(`Preferred endpoint '${preference}' is incompatible with the model operation capabilities`)
    }
  }

  return issues
}
