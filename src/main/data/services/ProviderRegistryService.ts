/**
 * Registry Service — merge-dependent operations that bridge registry data with SQLite.
 *
 * Responsibilities:
 * - resolveModels: resolve raw SDK model entries against registry
 * - lookupModel: DB-aware single model lookup with reasoning config
 * - mergePresetModel / createCustomModel / applyCapabilityOverride:
 *   pure functions exported for ModelService and the v2 migrator (which compose them
 *   with user-row overlay logic) — kept here because they belong to the registry domain
 *   (preset → override resolution, registry-derived reasoning resolution).
 *
 * Pure JSON loading, caching, and lookups live in @cherrystudio/provider-registry
 * (RegistryLoader, buildPersistedEndpointConfigs).
 */

import { application } from '@application'
import type {
  ProtoModelConfig,
  ProtoProviderModelOverride,
  ProtoReasoningSupport,
  ProviderModelReasoningContract,
  ProviderReasoningFormat,
  ReasoningEffort as ReasoningEffortType,
  ReasoningFormatType,
  ReasoningWireProfile
} from '@cherrystudio/provider-registry'
import type { EndpointType, Modality, ModelCapability } from '@cherrystudio/provider-registry'
import {
  buildPersistedEndpointConfigs,
  deriveLegacyReasoningFields,
  ENDPOINT_TYPE,
  inferAdapterFamily,
  inferReasoningControls,
  inferReasoningMembership,
  inferReasoningOwnedBy,
  MODEL_CAPABILITY,
  REASONING_EFFORT,
  REASONING_FORMAT_PROFILES
} from '@cherrystudio/provider-registry'
import { RegistryLoader } from '@cherrystudio/provider-registry/node'
import { loggerService } from '@logger'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import type { ImageGenerationSupport, Model, RuntimeModelPricing, RuntimeReasoning } from '@shared/data/types/model'
import { createUniqueModelId } from '@shared/data/types/model'
import type { EndpointConfig, Provider, ProviderWebsites } from '@shared/data/types/provider'

import { getDataService, registerDataService } from './dataServiceRegistry'

const logger = loggerService.withContext('DataApi:ProviderRegistryService')

export interface ProviderDisplayMetadata {
  description?: string
  websites?: ProviderWebsites
  /** Registry capability: where the model list comes from (default `'api'`). */
  modelListSource?: 'api' | 'registry'
  /** Registry capability: accepted credential kinds (default `['api-key']`). */
  authMethods?: ('api-key' | 'oauth' | 'external-cli')[]
  /** Registry capability: serves requests without any credential (default false). */
  authOptional?: boolean
}

export interface ListProviderRegistryModelsOptions {
  providerId?: string
  disabled?: boolean
}

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

const DEFAULT_FORMAT_BY_ENDPOINT: Partial<Record<EndpointType, ReasoningFormatType>> = {
  [ENDPOINT_TYPE.OPENAI_RESPONSES]: 'openai-responses',
  [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'openai-chat',
  [ENDPOINT_TYPE.OPENAI_TEXT_COMPLETIONS]: 'openai-chat',
  [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'anthropic',
  [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: 'gemini',
  [ENDPOINT_TYPE.OLLAMA_CHAT]: 'ollama',
  [ENDPOINT_TYPE.OLLAMA_GENERATE]: 'ollama'
}

export interface ResolvedReasoningProfile {
  format: ReasoningFormatType
  wire: ReasoningWireProfile
  support?: ProtoReasoningSupport
}

export type ReasoningProviderContext = Pick<Provider, 'id' | 'presetProviderId' | 'defaultChatEndpoint'>

/** Resolve profile data without consulting model/provider ids or regexes. */
export function resolveReasoningProfileFromRegistry(input: {
  endpointType: EndpointType | undefined
  format?: ProviderReasoningFormat
  contract?: ProviderModelReasoningContract
}): ResolvedReasoningProfile {
  const endpointDefault = input.endpointType ? DEFAULT_FORMAT_BY_ENDPOINT[input.endpointType] : undefined
  const formatType = input.format?.type ?? endpointDefault ?? 'openai-chat'
  const formatDefault = REASONING_FORMAT_PROFILES[formatType]
  const wire = input.contract?.wire ?? input.format?.wire ?? formatDefault.wire

  return { format: formatType, support: input.contract?.support, wire }
}

/**
 * Materialize the endpoint-projected vocabulary stored on every runtime model.
 * Renderer consumers read this result directly; they do not repeat capability/profile inference.
 */
function deriveSelectableEfforts(
  reasoning: ProtoReasoningSupport,
  profile: ReasoningWireProfile
): ReasoningEffortType[] {
  if (profile.disabled) return []

  const effortControl = reasoning.controls?.find((control) => control.kind === 'effort')
  const hasDeclaredControls = reasoning.controls !== undefined
  const hasBudget = reasoning.controls?.some((control) => control.kind === 'budget') ?? false
  const hasToggle = reasoning.controls?.some((control) => control.kind === 'toggle') ?? false

  let intrinsic: ReasoningEffortType[]
  if (effortControl?.kind === 'effort') {
    intrinsic = [...effortControl.values]
  } else if (!hasDeclaredControls && reasoning.supportedEfforts?.length) {
    intrinsic = [...reasoning.supportedEfforts]
  } else if (hasBudget) {
    intrinsic = [
      ...(hasToggle ? [REASONING_EFFORT.NONE] : []),
      REASONING_EFFORT.LOW,
      REASONING_EFFORT.MEDIUM,
      REASONING_EFFORT.HIGH
    ]
  } else if (hasToggle) {
    intrinsic = [REASONING_EFFORT.NONE, REASONING_EFFORT.AUTO]
  } else {
    intrinsic = []
  }

  return intrinsic.filter((selection) => {
    if (selection === REASONING_EFFORT.NONE) return profile.off !== undefined
    if (selection === REASONING_EFFORT.AUTO) return profile.auto !== undefined || profile.effort !== undefined
    return profile.effort !== undefined
  })
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

/**
 * Infer a reasoning descriptor for a model the catalog doesn't know, from the
 * registry's ID-pattern heuristics (ingest-time only, #16598). The membership
 * gate is built in: pass `declaredReasoning: true` to skip it when the
 * model's REASONING capability is already declared.
 */
export function inferCustomModelReasoning(
  modelId: string,
  profile: ReasoningWireProfile = REASONING_FORMAT_PROFILES['openai-chat'].wire,
  options?: { declaredReasoning?: boolean }
): RuntimeReasoning | undefined {
  if (!options?.declaredReasoning && !inferReasoningMembership(modelId)) return undefined
  const controls = inferReasoningControls(modelId)
  if (!controls) return undefined
  const proto: ProtoReasoningSupport = { controls, ...deriveLegacyReasoningFields(controls) }
  return projectRuntimeReasoning(proto, profile)
}

/** Create a minimal custom model used when a model ID has no registry match. */
export function createCustomModel(
  providerId: string,
  modelId: string,
  profile: ReasoningWireProfile = REASONING_FORMAT_PROFILES['openai-chat'].wire
): Model {
  // Ingest-time heuristics: an unmatched model still gets its reasoning
  // descriptor when the id is recognizably a reasoning SKU, so custom rows
  // are descriptor-driven like catalog rows (#16598).
  const reasoning = inferCustomModelReasoning(modelId, profile)
  return {
    id: createUniqueModelId(providerId, modelId),
    providerId,
    apiModelId: modelId,
    name: modelId,
    ownedBy: inferReasoningOwnedBy(modelId),
    capabilities: [],
    reasoning,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
}

/**
 * Synthesize a minimal `ProtoModelConfig` from a provider-models override when
 * no `models.json` entry exists for that model id. Lets `provider-models.json`
 * carry vendor-exclusive models (ModelScope's `Tongyi-MAI/Z-Image-Turbo`, PPIO
 * bespoke endpoints, …) entirely on its own — no entry needed in the global
 * model catalog.
 *
 * Capability resolution favors `force` (the new-row case) over `add`. The
 * synthesized preset feeds straight into `applyPresetAndOverride`, where the
 * override's modality / capability / pricing arrays already merge correctly.
 */
export function synthesizePresetFromOverride(override: ProtoProviderModelOverride): ProtoModelConfig {
  const capabilities = override.capabilities?.force ?? override.capabilities?.add ?? []
  return {
    id: override.modelId,
    name: override.name ?? override.modelId,
    description: override.description,
    family: override.family,
    ownedBy: override.ownedBy,
    capabilities,
    inputModalities: override.inputModalities,
    outputModalities: override.outputModalities,
    pricing: override.pricing as ProtoModelConfig['pricing'],
    imageGeneration: override.imageGeneration
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
  profile: ReasoningWireProfile = REASONING_FORMAT_PROFILES['openai-chat'].wire,
  reasoningSupport?: ProtoReasoningSupport
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

  const reasoning = resolveReasoning(reasoningSupport ?? presetModel.reasoning, profile)
  const resolvedCapabilities = reasoningSupport
    ? Array.from(new Set([...capabilities, MODEL_CAPABILITY.REASONING]))
    : capabilities

  return {
    id: createUniqueModelId(providerId, presetModel.id),
    providerId,
    apiModelId: catalogOverride?.apiModelId ?? presetModel.id,
    name,
    description,
    family: presetModel.family,
    ownedBy: catalogOverride?.ownedBy ?? presetModel.ownedBy,
    capabilities: resolvedCapabilities,
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

function mergeReasoningSupport(
  preset: ProtoReasoningSupport | undefined,
  override: ProtoReasoningSupport | undefined
): ProtoReasoningSupport | undefined {
  if (!preset && !override) return undefined
  return {
    controls: override?.controls ?? preset?.controls,
    supportedEfforts: override?.supportedEfforts ?? preset?.supportedEfforts,
    thinkingTokenLimits: override?.thinkingTokenLimits ?? preset?.thinkingTokenLimits,
    defaultEffort: override?.defaultEffort ?? preset?.defaultEffort
  }
}

/** Resolve intrinsic reasoning data and project it through the active endpoint profile. */
function resolveReasoning(
  reasoningSupport: ProtoReasoningSupport | undefined,
  profile: ReasoningWireProfile
): RuntimeReasoning | undefined {
  if (!reasoningSupport) return undefined
  return projectRuntimeReasoning(reasoningSupport, profile)
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

/** Convert proto reasoning data to the provider-neutral runtime form. */
export function projectRuntimeReasoning(
  reasoning: ProtoReasoningSupport,
  profile: ReasoningWireProfile
): RuntimeReasoning {
  return {
    controls: reasoning.controls,
    selectableEfforts: deriveSelectableEfforts(reasoning, profile),
    thinkingTokenLimits: reasoning.thinkingTokenLimits,
    defaultEffort: reasoning.defaultEffort
  }
}

/**
 * Bridges the read-only provider registry (JSON) with SQLite user data.
 *
 * This service handles operations that require merging preset model/provider
 * data from the registry package with user-specific connection facts stored
 * in the database (for example, the active endpoint type).
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

  clearCache(): void {
    this.loader = null
  }

  private findRegistryProvider(providerId: string) {
    return this.getLoader()
      .loadProviders()
      .find((provider) => provider.id === providerId)
  }

  resolveAdapterFamilies(
    endpointConfigs: Partial<Record<EndpointType, EndpointConfig>> | null | undefined,
    presetProviderId?: string | null
  ): Partial<Record<EndpointType, EndpointConfig>> | null {
    if (!endpointConfigs || Object.keys(endpointConfigs).length === 0) return null

    const presetProvider = presetProviderId ? this.findRegistryProvider(presetProviderId) : undefined
    const presetConfigs = presetProvider
      ? (buildPersistedEndpointConfigs(presetProvider.endpointConfigs) as Partial<
          Record<EndpointType, EndpointConfig>
        > | null)
      : null

    const result: Partial<Record<EndpointType, EndpointConfig>> = {}
    for (const [key, config] of Object.entries(endpointConfigs)) {
      if (!config) continue
      const ep = key as EndpointType
      result[ep] = config.adapterFamily
        ? config
        : { ...config, adapterFamily: presetConfigs?.[ep]?.adapterFamily ?? inferAdapterFamily(ep) }
    }
    return result
  }

  /**
   * True when `providerId` is a canonical registry preset row (seeded from
   * providers.json), regardless of its `presetProviderId`. Used to keep
   * preset rows undeletable even when they declare a grouping preset
   * different from their own id (e.g. zai → zhipu).
   */
  isRegistryProvider(providerId: string): boolean {
    try {
      return this.findRegistryProvider(providerId) !== undefined
    } catch (error) {
      // Registry unavailable — fall back to the caller's primary guard
      // rather than throwing inside a delete transaction.
      logger.warn('Failed to check registry provider', { providerId, error })
      return false
    }
  }

  getProviderDisplayMetadata(providerId: string, presetProviderId?: string): ProviderDisplayMetadata {
    try {
      const provider =
        this.findRegistryProvider(providerId) ??
        (presetProviderId ? this.findRegistryProvider(presetProviderId) : undefined)

      return {
        description: provider?.description,
        websites: provider?.metadata?.website,
        modelListSource: provider?.modelListSource,
        authMethods: provider?.authMethods,
        authOptional: provider?.authOptional
      }
    } catch (error) {
      logger.warn('Failed to load provider display metadata', { providerId, presetProviderId, error })
      return {}
    }
  }

  private getEffectiveProviderContext(providerId: string): ReasoningProviderContext {
    const registryProvider = this.findRegistryProvider(providerId)
    try {
      const provider = getDataService('ProviderService').getByProviderId(providerId)
      return {
        id: provider.id,
        presetProviderId: provider.presetProviderId,
        defaultChatEndpoint: provider.defaultChatEndpoint ?? registryProvider?.defaultChatEndpoint ?? undefined
      }
    } catch (error) {
      if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
        return {
          id: providerId,
          presetProviderId: registryProvider?.presetProviderId,
          defaultChatEndpoint: registryProvider?.defaultChatEndpoint ?? undefined
        }
      }
      logger.error('Failed to fetch provider for reasoning profile', error as Error)
      throw error
    }
  }

  private findProfileProvider(context: Pick<Provider, 'id' | 'presetProviderId'>) {
    return (
      this.findRegistryProvider(context.id) ??
      (context.presetProviderId ? this.findRegistryProvider(context.presetProviderId) : undefined)
    )
  }

  private resolveProfileForModelData(
    context: ReasoningProviderContext,
    presetModel: ProtoModelConfig | null,
    registryOverride: ProtoProviderModelOverride | null,
    fallbackModelId: string
  ): ResolvedReasoningProfile {
    const profileProvider = this.findProfileProvider(context)
    const endpointType = resolveReasoningEndpointType(
      registryOverride?.endpointTypes,
      context.defaultChatEndpoint ?? profileProvider?.defaultChatEndpoint ?? undefined
    )
    const contract = endpointType ? registryOverride?.reasoningContracts?.[endpointType] : undefined
    const inferredControls =
      presetModel?.reasoning || contract?.support ? undefined : inferReasoningControls(fallbackModelId)
    const reasoning =
      mergeReasoningSupport(presetModel?.reasoning, contract?.support) ??
      (inferredControls ? { controls: inferredControls } : undefined)
    const resolved = resolveReasoningProfileFromRegistry({
      endpointType,
      format: endpointType ? profileProvider?.endpointConfigs?.[endpointType]?.reasoningFormat : undefined,
      contract
    })
    return { ...resolved, support: reasoning }
  }

  /** Resolve the main-only wire profile for one already materialized request model. */
  resolveReasoningProfile(
    provider: ReasoningProviderContext,
    model: Model,
    endpointType?: EndpointType
  ): ResolvedReasoningProfile {
    const profileProvider = this.findProfileProvider(provider)
    const effectiveEndpoint =
      endpointType ?? resolveReasoningEndpointType(model.endpointTypes, provider.defaultChatEndpoint)
    const providerIds = Array.from(
      new Set([provider.id, profileProvider?.id, provider.presetProviderId].filter((value): value is string => !!value))
    )
    const modelIds = Array.from(
      new Set([model.apiModelId, model.presetModelId].filter((value): value is string => !!value))
    )
    let contract: ProviderModelReasoningContract | undefined
    let matchedOverride: ProtoProviderModelOverride | null = null
    for (const providerId of providerIds) {
      for (const modelId of modelIds) {
        const candidate = this.getLoader().findOverride(providerId, modelId)
        contract = effectiveEndpoint ? candidate?.reasoningContracts?.[effectiveEndpoint] : undefined
        if (contract) matchedOverride = candidate
        if (contract) break
      }
      if (contract) break
    }

    const resolved = resolveReasoningProfileFromRegistry({
      endpointType: effectiveEndpoint,
      format: effectiveEndpoint ? profileProvider?.endpointConfigs?.[effectiveEndpoint]?.reasoningFormat : undefined,
      contract
    })
    const presetReasoning = this.getLoader().findModel(matchedOverride?.modelId ?? model.presetModelId ?? '')?.reasoning
    return {
      ...resolved,
      support: mergeReasoningSupport(presetReasoning ?? model.reasoning, contract?.support)
    }
  }

  resolveRegistryModelProfile(
    providerId: string,
    presetModel: ProtoModelConfig,
    registryOverride: ProtoProviderModelOverride | null,
    defaultChatEndpoint?: EndpointType
  ): ResolvedReasoningProfile {
    const registryProvider = this.findRegistryProvider(providerId)
    return this.resolveProfileForModelData(
      {
        id: providerId,
        presetProviderId: registryProvider?.presetProviderId,
        defaultChatEndpoint: defaultChatEndpoint ?? registryProvider?.defaultChatEndpoint ?? undefined
      },
      presetModel,
      registryOverride,
      registryOverride?.apiModelId ?? presetModel.id
    )
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
  lookupModel(
    providerId: string,
    modelId: string,
    providerContextCache?: Map<string, ReasoningProviderContext>
  ): {
    presetModel: ProtoModelConfig | null
    registryOverride: ProtoProviderModelOverride | null
    reasoningProfile: ResolvedReasoningProfile
  } {
    const loader = this.getLoader()
    const registryOverride = loader.findOverride(providerId, modelId)
    const presetModel =
      loader.findModel(registryOverride?.modelId ?? modelId) ??
      (registryOverride ? synthesizePresetFromOverride(registryOverride) : null)
    // Provider context reads the provider row from the DB; when an
    // optional cache is supplied (batch enrichment in `ModelService.list`),
    // resolve it once per provider instead of once per model.
    let providerContext = providerContextCache?.get(providerId)
    if (!providerContext) {
      providerContext = this.getEffectiveProviderContext(providerId)
      providerContextCache?.set(providerId, providerContext)
    }

    return {
      presetModel,
      registryOverride,
      reasoningProfile: this.resolveProfileForModelData(providerContext, presetModel, registryOverride, modelId)
    }
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
  resolveModels(providerId: string, modelIds: string[]): Model[] {
    const loader = this.getLoader()
    const providerContext = this.getEffectiveProviderContext(providerId)

    const results: Model[] = []
    const seen = new Set<string>()

    for (const modelId of modelIds) {
      if (!modelId || seen.has(modelId)) continue
      seen.add(modelId)

      // O(1) lookup with exact match + normalized fallback
      const registryOverride = loader.findOverride(providerId, modelId)
      const presetModel =
        loader.findModel(registryOverride?.modelId ?? modelId) ??
        (registryOverride ? synthesizePresetFromOverride(registryOverride) : null)
      const reasoningProfile = this.resolveProfileForModelData(providerContext, presetModel, registryOverride, modelId)

      if (presetModel) {
        const model = mergePresetModel(
          presetModel,
          registryOverride,
          providerId,
          reasoningProfile.wire,
          reasoningProfile.support
        )
        // `mergePresetModel` keys `id` off the canonical `presetModel.id`, which collapses providers that
        // serve one canonical model under several apiModelIds (e.g. tokenhub's dated 原厂直供 variants both
        // resolve to `deepseek-v4-flash`). Mirror `listProviderRegistryModels`: rebuild the unique id from
        // the exact apiModelId and keep the canonical `presetModelId`, so sync/reconcile (which key on
        // `model.id`) don't drop or mis-diff the dated variant against the undated row.
        const apiModelId = model.apiModelId ?? registryOverride?.apiModelId ?? modelId
        results.push({
          ...model,
          id: createUniqueModelId(providerId, apiModelId),
          apiModelId,
          presetModelId: presetModel.id
        })
      } else {
        results.push(createCustomModel(providerId, modelId, reasoningProfile.wire))
      }
    }

    return results
  }

  listProviderRegistryModels(options: ListProviderRegistryModelsOptions = {}): Model[] {
    const loader = this.getLoader()
    const overrides = options.providerId
      ? loader.getOverridesForProvider(options.providerId)
      : loader.loadProviderModels()
    const includeDisabled = options.disabled ?? false
    const providerContextByProvider = new Map<string, ReasoningProviderContext>()
    const results: Model[] = []

    for (const override of overrides) {
      if ((override.disabled ?? false) !== includeDisabled) continue

      // Synthesize a preset when models.json has no entry — vendor-exclusive
      // models (modelscope's Tongyi-MAI/*, ppio bespoke endpoints, …) live
      // entirely inside provider-models.json with their imageGeneration
      // block declared inline. Reduces models.json clutter from
      // single-provider entries.
      const presetModel = loader.findModel(override.modelId) ?? synthesizePresetFromOverride(override)

      let providerContext = providerContextByProvider.get(override.providerId)
      if (!providerContext) {
        const registryProvider = this.findRegistryProvider(override.providerId)
        providerContext = {
          id: override.providerId,
          presetProviderId: registryProvider?.presetProviderId,
          defaultChatEndpoint: registryProvider?.defaultChatEndpoint ?? undefined
        }
        providerContextByProvider.set(override.providerId, providerContext)
      }

      const reasoningProfile = this.resolveProfileForModelData(
        providerContext,
        presetModel,
        override,
        override.apiModelId ?? override.modelId
      )
      const model = mergePresetModel(
        presetModel,
        override,
        override.providerId,
        reasoningProfile.wire,
        reasoningProfile.support
      )

      const apiModelId = model.apiModelId ?? override.apiModelId ?? override.modelId
      results.push({
        ...model,
        id: createUniqueModelId(override.providerId, apiModelId),
        apiModelId,
        presetModelId: presetModel.id
      })
    }

    return results
  }

  /**
   * Read the painting-page metadata block the registry exposes for a
   * (provider, model) pair. Drives the generic painting form: providers
   * opting into `useRegistryForm` derive their field set from this block
   * instead of a hand-rolled `fields.ts`.
   *
   * Resolution order:
   *  1. Per-(provider, model) `imageGeneration` override from the
   *     provider-model registry (vendor-exclusive UI).
   *  2. Model-level `imageGeneration` from `models.json` (per-model UI).
   *  3. `null` — renderer falls back to the provider's `fields.byTab`.
   *
   * Used by: GET /providers/:providerId/models/:modelId/image-generation-support
   * (greedy `:modelId` capture for HuggingFace-style ids containing `/`).
   */
  getImageGenerationSupport(providerId: string, modelId: string): ImageGenerationSupport | null {
    const { presetModel, registryOverride } = this.lookupModel(providerId, modelId)
    // Override wins — lets vendor-exclusive overrides declare their own
    // imageGeneration block without polluting the global models.json.
    if (registryOverride?.imageGeneration) return registryOverride.imageGeneration
    if (presetModel?.imageGeneration) return presetModel.imageGeneration
    return null
  }
}

export const providerRegistryService = new ProviderRegistryService()

registerDataService('ProviderRegistryService', providerRegistryService)
