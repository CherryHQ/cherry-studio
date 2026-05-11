/**
 * Registry Service — merge-dependent operations that bridge registry data with SQLite.
 *
 * Responsibilities:
 * - resolveModels: resolve raw SDK model entries against registry
 * - lookupModel: DB-aware single model lookup with reasoning config
 * - mergePresetModel / createCustomModel / applyCapabilityOverride / extractReasoningFormatTypes:
 *   pure functions exported for ModelService and the v2 migrator (which compose them
 *   with user-row overlay logic) — kept here because they belong to the registry domain
 *   (preset → override resolution, registry-derived reasoning resolution).
 *
 * Pure JSON loading, caching, and lookups live in @cherrystudio/provider-registry
 * (RegistryLoader, buildRuntimeEndpointConfigs).
 */

import { application } from '@application'
import type {
  ProtoModelConfig,
  ProtoProviderModelOverride,
  ProtoReasoningSupport,
  ReasoningEffort as ReasoningEffortType
} from '@cherrystudio/provider-registry'
import type { EndpointType, Modality, ModelCapability } from '@cherrystudio/provider-registry'
import { buildRuntimeEndpointConfigs, ENDPOINT_TYPE, REASONING_EFFORT } from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { loggerService } from '@logger'
import { ErrorCode, isDataApiError } from '@shared/data/api/apiErrors'
import type { Model, RuntimeModelPricing, RuntimeReasoning } from '@shared/data/types/model'
import { createUniqueModelId } from '@shared/data/types/model'
import type { EndpointConfig, ReasoningFormatType } from '@shared/data/types/provider'

import { providerService } from './ProviderService'

const logger = loggerService.withContext('DataApi:ProviderRegistryService')

// ═══════════════════════════════════════════════════════════════════════════════
// Registry → Runtime Model merge functions
// ═══════════════════════════════════════════════════════════════════════════════

/** Endpoints that can carry reasoning. Order is the fallback priority for picking the chat endpoint. */
const CHAT_REASONING_ENDPOINT_PRIORITY: EndpointType[] = [
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  ENDPOINT_TYPE.OLLAMA_CHAT,
  ENDPOINT_TYPE.OLLAMA_GENERATE,
  ENDPOINT_TYPE.OPENAI_TEXT_COMPLETIONS
]

/** Default effort levels per reasoning format type (when not specified in catalog) */
const DEFAULT_EFFORTS: Partial<Record<ReasoningFormatType, ReasoningEffortType[]>> = {
  'openai-chat': [
    REASONING_EFFORT.NONE,
    REASONING_EFFORT.MINIMAL,
    REASONING_EFFORT.LOW,
    REASONING_EFFORT.MEDIUM,
    REASONING_EFFORT.HIGH
  ],
  'openai-responses': [
    REASONING_EFFORT.NONE,
    REASONING_EFFORT.MINIMAL,
    REASONING_EFFORT.LOW,
    REASONING_EFFORT.MEDIUM,
    REASONING_EFFORT.HIGH
  ],
  anthropic: [],
  gemini: [REASONING_EFFORT.LOW, REASONING_EFFORT.MEDIUM, REASONING_EFFORT.HIGH],
  'enable-thinking': [REASONING_EFFORT.NONE, REASONING_EFFORT.LOW, REASONING_EFFORT.MEDIUM, REASONING_EFFORT.HIGH],
  'thinking-type': [REASONING_EFFORT.NONE, REASONING_EFFORT.AUTO]
}

/** Apply add/remove/force capability override on top of a base list. */
export function applyCapabilityOverride(
  base: ModelCapability[],
  override: { add?: ModelCapability[]; remove?: ModelCapability[]; force?: ModelCapability[] } | null | undefined
): ModelCapability[] {
  if (!override) {
    return [...base]
  }

  if (override.force && override.force.length > 0) {
    return [...override.force]
  }

  let result = [...base]

  if (override.add?.length) {
    result = Array.from(new Set([...result, ...override.add]))
  }

  if (override.remove?.length) {
    const removeSet = new Set(override.remove)
    result = result.filter((c) => !removeSet.has(c))
  }

  return result
}

/** Pull `reasoningFormatType` per endpoint out of `endpointConfigs`. */
export function extractReasoningFormatTypes(
  endpointConfigs: Partial<Record<EndpointType, EndpointConfig>> | null | undefined
): Partial<Record<EndpointType, ReasoningFormatType>> | undefined {
  if (!endpointConfigs) return undefined
  const result: Partial<Record<EndpointType, ReasoningFormatType>> = {}
  for (const [k, v] of Object.entries(endpointConfigs)) {
    if (v?.reasoningFormatType) {
      result[k as EndpointType] = v.reasoningFormatType
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** Create a minimal custom model used when a model ID has no registry match. */
export function createCustomModel(providerId: string, modelId: string): Model {
  return {
    id: createUniqueModelId(providerId, modelId),
    providerId,
    apiModelId: modelId,
    name: modelId,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
}

/**
 * Two-layer merge: preset → override. No user data involved.
 *
 * Used by `resolveModels` and (via composition with `applyUserOverlay` in ModelService)
 * by `ModelService.create` and the migrator.
 */
export function mergePresetModel(
  presetModel: ProtoModelConfig,
  catalogOverride: ProtoProviderModelOverride | null,
  providerId: string,
  reasoningFormatTypes?: Partial<Record<EndpointType, ReasoningFormatType>> | null,
  defaultChatEndpoint?: EndpointType
): Model {
  const {
    capabilities,
    inputModalities,
    outputModalities,
    endpointTypes,
    name,
    description,
    contextWindow,
    maxOutputTokens,
    maxInputTokens,
    pricing,
    replaceWith
  } = applyPresetAndOverride(presetModel, catalogOverride)

  const reasoningFormatType = resolveReasoningFormatType(endpointTypes, defaultChatEndpoint, reasoningFormatTypes)
  const reasoning = resolveReasoning(presetModel, catalogOverride, reasoningFormatType)

  return {
    id: createUniqueModelId(providerId, presetModel.id),
    providerId,
    apiModelId: catalogOverride?.apiModelId ?? presetModel.id,
    name,
    description,
    family: presetModel.family,
    ownedBy: presetModel.ownedBy,
    capabilities,
    inputModalities,
    outputModalities,
    contextWindow,
    maxOutputTokens,
    maxInputTokens,
    endpointTypes,
    supportsStreaming: true,
    reasoning,
    pricing,
    isEnabled: !(catalogOverride?.disabled ?? false),
    isHidden: false,
    replaceWith: replaceWith ? createUniqueModelId(providerId, replaceWith) : undefined
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers (not exported)
// ─────────────────────────────────────────────────────────────────────────────

/** Apply preset → override to all non-reasoning fields. */
function applyPresetAndOverride(presetModel: ProtoModelConfig, catalogOverride: ProtoProviderModelOverride | null) {
  let capabilities: ModelCapability[] = [...(presetModel.capabilities ?? [])]
  let inputModalities: Modality[] | undefined = presetModel.inputModalities?.length
    ? [...presetModel.inputModalities]
    : undefined
  let outputModalities: Modality[] | undefined = presetModel.outputModalities?.length
    ? [...presetModel.outputModalities]
    : undefined
  let endpointTypes: EndpointType[] | undefined = undefined
  const name = presetModel.name ?? presetModel.id
  const description = presetModel.description
  let contextWindow = presetModel.contextWindow
  let maxOutputTokens = presetModel.maxOutputTokens
  let maxInputTokens = presetModel.maxInputTokens
  let pricing: RuntimeModelPricing | undefined
  let replaceWith: string | undefined

  if (presetModel.pricing) {
    pricing = {
      input: {
        perMillionTokens: presetModel.pricing.input?.perMillionTokens ?? null,
        currency: presetModel.pricing.input?.currency
      },
      output: {
        perMillionTokens: presetModel.pricing.output?.perMillionTokens ?? null,
        currency: presetModel.pricing.output?.currency
      },
      cacheRead: presetModel.pricing.cacheRead
        ? {
            perMillionTokens: presetModel.pricing.cacheRead.perMillionTokens ?? null,
            currency: presetModel.pricing.cacheRead.currency
          }
        : undefined,
      cacheWrite: presetModel.pricing.cacheWrite
        ? {
            perMillionTokens: presetModel.pricing.cacheWrite.perMillionTokens ?? null,
            currency: presetModel.pricing.cacheWrite.currency
          }
        : undefined
    }
  }

  if (catalogOverride) {
    if (catalogOverride.capabilities) capabilities = applyCapabilityOverride(capabilities, catalogOverride.capabilities)
    if (catalogOverride.limits?.contextWindow != null) contextWindow = catalogOverride.limits.contextWindow
    if (catalogOverride.limits?.maxOutputTokens != null) maxOutputTokens = catalogOverride.limits.maxOutputTokens
    if (catalogOverride.limits?.maxInputTokens != null) maxInputTokens = catalogOverride.limits.maxInputTokens
    if (catalogOverride.endpointTypes?.length) endpointTypes = [...catalogOverride.endpointTypes]
    if (catalogOverride.inputModalities?.length) inputModalities = [...catalogOverride.inputModalities]
    if (catalogOverride.outputModalities?.length) outputModalities = [...catalogOverride.outputModalities]
    if (catalogOverride.replaceWith) replaceWith = catalogOverride.replaceWith
  }

  return {
    capabilities,
    inputModalities,
    outputModalities,
    endpointTypes,
    name,
    description,
    contextWindow,
    maxOutputTokens,
    maxInputTokens,
    pricing,
    replaceWith
  }
}

/** Resolve reasoning data from preset + override, filtered by the active reasoning format type. */
function resolveReasoning(
  presetModel: ProtoModelConfig,
  catalogOverride: ProtoProviderModelOverride | null,
  reasoningFormatType: ReasoningFormatType | undefined
): RuntimeReasoning | undefined {
  let reasoning: RuntimeReasoning | undefined

  if (presetModel.reasoning) {
    reasoning = extractRuntimeReasoning(presetModel.reasoning, reasoningFormatType)
  }

  if (catalogOverride?.reasoning) {
    const overrideReasoning = extractRuntimeReasoning(catalogOverride.reasoning, reasoningFormatType)
    reasoning = {
      ...overrideReasoning,
      thinkingTokenLimits: overrideReasoning.thinkingTokenLimits ?? reasoning?.thinkingTokenLimits
    }
  }

  return reasoning
}

function isChatReasoningEndpointType(endpointType: EndpointType): boolean {
  return CHAT_REASONING_ENDPOINT_PRIORITY.includes(endpointType)
}

function resolveReasoningEndpointType(
  endpointTypes: EndpointType[] | undefined,
  defaultChatEndpoint: EndpointType | undefined
): EndpointType | undefined {
  const candidates = (endpointTypes ?? []).filter(isChatReasoningEndpointType)

  if (candidates.length === 1) {
    return candidates[0]
  }

  if (defaultChatEndpoint !== undefined && isChatReasoningEndpointType(defaultChatEndpoint)) {
    if (candidates.length === 0 || candidates.includes(defaultChatEndpoint)) {
      return defaultChatEndpoint
    }
  }

  for (const endpointType of CHAT_REASONING_ENDPOINT_PRIORITY) {
    if (candidates.includes(endpointType)) {
      return endpointType
    }
  }

  return undefined
}

function resolveReasoningFormatType(
  endpointTypes: EndpointType[] | undefined,
  defaultChatEndpoint: EndpointType | undefined,
  reasoningFormatTypes: Partial<Record<EndpointType, ReasoningFormatType>> | null | undefined
): ReasoningFormatType | undefined {
  const endpointType = resolveReasoningEndpointType(endpointTypes, defaultChatEndpoint)
  if (endpointType === undefined || !reasoningFormatTypes) {
    return undefined
  }

  return reasoningFormatTypes[endpointType]
}

/** Convert proto reasoning data to runtime form using the active reasoning format type. */
function extractRuntimeReasoning(
  reasoning: ProtoReasoningSupport,
  reasoningFormatType: ReasoningFormatType | undefined
): RuntimeReasoning {
  const type = reasoningFormatType ?? ''

  let supportedEfforts: ReasoningEffortType[] = [...(reasoning.supportedEfforts ?? [])]
  if (supportedEfforts.length === 0) {
    supportedEfforts = DEFAULT_EFFORTS[type] ?? []
  }

  return {
    type,
    supportedEfforts,
    thinkingTokenLimits: reasoning.thinkingTokenLimits
  }
}

/**
 * Bridges the read-only provider registry (JSON) with SQLite user data.
 *
 * This service handles operations that require merging preset model/provider
 * data from the registry package with user-specific configuration stored in
 * the database (e.g. reasoning format overrides from `user_provider`).
 *
 * It does **not** own any database table and does **not** access the
 * database directly. User data is obtained via `ProviderService`.
 *
 * @see {@link RegistryLoader} for JSON loading, caching, and O(1) indexed lookups
 * @see {@link mergePresetModel} for the two-layer merge (preset → override)
 * @see {@link mergeModelWithUser} for the three-layer merge (preset → override → user)
 */
class ProviderRegistryService {
  private loader: RegistryLoader | null = null

  /** Lazily create the shared RegistryLoader instance. */
  private getLoader(): RegistryLoader {
    if (!this.loader) {
      this.loader = new RegistryLoader({
        models: application.getPath('feature.provider_registry.data', 'models.json'),
        providers: application.getPath('feature.provider_registry.data', 'providers.json'),
        providerModels: application.getPath('feature.provider_registry.data', 'provider-models.json')
      })
    }
    return this.loader
  }

  /**
   * Get reasoning config from registry providers.json only (no DB).
   *
   * Resolves `defaultChatEndpoint` and `reasoningFormatTypes` for a provider
   * by looking up its `endpointConfigs` in the shipped registry data.
   *
   * @param providerId - The provider to look up
   * @returns Registry-level reasoning config (may be overridden by user DB values)
   */
  private getRegistryReasoningConfig(providerId: string): {
    defaultChatEndpoint?: EndpointType
    reasoningFormatTypes?: Partial<Record<EndpointType, ReasoningFormatType>>
  } {
    const loader = this.getLoader()
    const providers = loader.loadProviders()
    const provider = providers.find((p) => p.id === providerId)
    const endpointConfigs = provider
      ? (buildRuntimeEndpointConfigs(provider.endpointConfigs) as Partial<Record<EndpointType, EndpointConfig>> | null)
      : null

    return {
      defaultChatEndpoint: provider?.defaultChatEndpoint ?? undefined,
      reasoningFormatTypes: extractReasoningFormatTypes(endpointConfigs)
    }
  }

  /**
   * Get effective reasoning config by merging registry defaults with user DB overrides.
   *
   * Priority: user_provider DB values > registry providers.json defaults.
   * Obtains user provider data via ProviderService (does not access DB directly).
   *
   * @param providerId - The provider to resolve config for
   * @returns Merged reasoning config with user overrides applied
   */
  private async getEffectiveReasoningConfig(providerId: string): Promise<{
    defaultChatEndpoint?: EndpointType
    reasoningFormatTypes?: Partial<Record<EndpointType, ReasoningFormatType>>
  }> {
    const registryConfig = this.getRegistryReasoningConfig(providerId)

    try {
      const provider = await providerService.getByProviderId(providerId)
      const defaultChatEndpoint = provider.defaultChatEndpoint ?? registryConfig.defaultChatEndpoint
      const reasoningFormatTypes =
        extractReasoningFormatTypes(provider.endpointConfigs) ?? registryConfig.reasoningFormatTypes

      return { defaultChatEndpoint, reasoningFormatTypes }
    } catch (error) {
      if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
        return registryConfig
      }

      logger.error('Failed to fetch provider for reasoning config', error as Error)
      throw error
    }
  }

  /**
   * Look up a single model's registry data and effective reasoning config.
   *
   * Combines O(1) indexed registry lookup (exact match + normalized fallback via
   * {@link RegistryLoader.findModel}) with DB-aware reasoning config resolution.
   *
   * Used by: `POST /models` handler — the handler calls this, then passes
   * the result to `ModelService.create([{ dto, registryData }])` to avoid a
   * circular dependency between ModelService and this service.
   *
   * @param providerId - The provider context for override and reasoning lookup
   * @param modelId - The model ID to look up (supports normalized fallback)
   * @returns Preset model, provider override, and effective reasoning config
   */
  async lookupModel(
    providerId: string,
    modelId: string
  ): Promise<{
    presetModel: ProtoModelConfig | null
    registryOverride: ProtoProviderModelOverride | null
    defaultChatEndpoint?: EndpointType
    reasoningFormatTypes?: Partial<Record<EndpointType, ReasoningFormatType>>
  }> {
    const loader = this.getLoader()
    const presetModel = loader.findModel(modelId)
    const registryOverride = loader.findOverride(providerId, modelId)
    const reasoningConfig = await this.getEffectiveReasoningConfig(providerId)

    return { presetModel, registryOverride, ...reasoningConfig }
  }

  /**
   * Resolve raw model IDs (e.g. from provider SDK listModels) against the registry.
   *
   * For each model ID, looks up its preset data and provider override from
   * the registry, then merges (preset → override). All data comes from
   * the registry — SDK only provides the model ID for matching.
   * Models not found in the registry are returned as minimal custom models.
   * Registry merge failures are fatal so callers do not persist or preview
   * incomplete results as a successful sync.
   * Duplicates (by modelId) are deduplicated — first occurrence wins.
   *
   * Used by: `GET /providers/:providerId/models:resolve?ids=...`
   *
   * @param providerId - The provider context
   * @param modelIds - Model IDs from SDK listModels()
   * @returns Array of fully resolved Model objects
   */
  async resolveModels(providerId: string, modelIds: string[]): Promise<Model[]> {
    const loader = this.getLoader()
    const { defaultChatEndpoint, reasoningFormatTypes } = await this.getEffectiveReasoningConfig(providerId)

    const results: Model[] = []
    const seen = new Set<string>()

    for (const modelId of modelIds) {
      if (!modelId || seen.has(modelId)) continue
      seen.add(modelId)

      // O(1) lookup with exact match + normalized fallback
      const presetModel = loader.findModel(modelId)
      const registryOverride = loader.findOverride(providerId, modelId)

      if (presetModel) {
        results.push(
          mergePresetModel(presetModel, registryOverride, providerId, reasoningFormatTypes, defaultChatEndpoint)
        )
      } else {
        results.push(createCustomModel(providerId, modelId))
      }
    }

    return results
  }
}

export const providerRegistryService = new ProviderRegistryService()
