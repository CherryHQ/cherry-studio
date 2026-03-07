/**
 * Model and Provider configuration merging utilities
 *
 * These utilities merge configurations from different sources with
 * the correct priority order.
 */

import type {
  ProtoModelConfig,
  ProtoProviderConfig,
  ProtoProviderModelOverride,
  ProtoReasoning
} from '@cherrystudio/provider-catalog'
import type { Modality, ModelCapability, ReasoningEffort as ReasoningEffortType } from '@cherrystudio/provider-catalog'
import { EndpointType, ReasoningEffort } from '@cherrystudio/provider-catalog'
import * as z from 'zod'

import type { Model, RuntimeModelPricing, RuntimeReasoning } from '../types/model'
import { createUniqueModelId } from '../types/model'
import type { Provider, ProviderSettings, RuntimeApiCompatibility } from '../types/provider'
import {
  ApiCompatibilitySchema,
  ApiKeyEntrySchema,
  DEFAULT_API_COMPATIBILITY,
  DEFAULT_PROVIDER_SETTINGS,
  ProviderSettingsSchema
} from '../types/provider'

export type { ProtoModelConfig as CatalogModel, ProtoProviderModelOverride as CatalogProviderModelOverride }

export { DEFAULT_API_COMPATIBILITY, DEFAULT_PROVIDER_SETTINGS }

/**
 * Apply capability override to a base capability list
 *
 * @param base - Base capability list
 * @param override - Override operations (add/remove/force)
 * @returns Merged capability list
 */
export function applyCapabilityOverride(
  base: ModelCapability[],
  override: { add: ModelCapability[]; remove: ModelCapability[]; force: ModelCapability[] } | null | undefined
): ModelCapability[] {
  if (!override) {
    return [...base]
  }

  // Force completely replaces the base
  if (override.force && override.force.length > 0) {
    return [...override.force]
  }

  let result = [...base]

  // Add new capabilities
  if (override.add.length) {
    result = Array.from(new Set([...result, ...override.add]))
  }

  // Remove capabilities
  if (override.remove.length) {
    const removeSet = new Set(override.remove)
    result = result.filter((c) => !removeSet.has(c))
  }

  return result
}

const UserProviderRowSchema = z.object({
  providerId: z.string(),
  presetProviderId: z.string().nullish(),
  name: z.string(),
  baseUrls: z.record(z.string(), z.string()).nullish(),
  defaultChatEndpoint: z.nativeEnum(EndpointType).nullish(),
  apiKeys: z.array(ApiKeyEntrySchema.pick({ id: true, key: true, label: true, isEnabled: true })).nullish(),
  authConfig: z.object({ type: z.string() }).catchall(z.unknown()).nullish(),
  apiCompatibility: ApiCompatibilitySchema.nullish(),
  providerSettings: ProviderSettingsSchema.partial().nullish(),
  isEnabled: z.boolean().nullish(),
  sortOrder: z.number().nullish()
})

type UserProviderRow = z.infer<typeof UserProviderRowSchema>

const UserModelRowSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
  presetModelId: z.string().nullable(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  group: z.string().nullish(),
  capabilities: z.array(z.number()).nullish(),
  inputModalities: z.array(z.number()).nullish(),
  outputModalities: z.array(z.number()).nullish(),
  endpointTypes: z.array(z.number()).nullish(),
  customEndpointUrl: z.string().nullish(),
  contextWindow: z.number().nullish(),
  maxOutputTokens: z.number().nullish(),
  supportsStreaming: z.boolean().nullish(),
  reasoning: z.record(z.string(), z.unknown()).nullish(),
  parameterSupport: z.record(z.string(), z.unknown()).nullish(),
  isEnabled: z.boolean().nullish(),
  isHidden: z.boolean().nullish(),
  sortOrder: z.number().nullish(),
  notes: z.string().nullish()
})

type UserModelRow = z.infer<typeof UserModelRowSchema>

/**
 * Merge model configurations from all sources
 *
 * Priority: userModel > catalogOverride > presetModel
 *
 * @param userModel - User model from SQLite (or null)
 * @param catalogOverride - Catalog provider-model override (or null)
 * @param presetModel - Preset model from catalog (or null)
 * @param providerId - Provider ID for the result
 * @returns Merged Model
 */
export function mergeModelConfig(
  userModel: UserModelRow | null,
  catalogOverride: ProtoProviderModelOverride | null,
  presetModel: ProtoModelConfig | null,
  providerId: string
): Model {
  // Case 1: Fully custom user model (no preset association)
  if (userModel && !userModel.presetModelId) {
    return {
      id: createUniqueModelId(providerId, userModel.modelId),
      providerId,
      name: userModel.name ?? userModel.modelId,
      description: userModel.description ?? undefined,
      group: userModel.group ?? undefined,
      capabilities: (userModel.capabilities ?? []) as ModelCapability[],
      inputModalities: (userModel.inputModalities ?? undefined) as Modality[] | undefined,
      outputModalities: (userModel.outputModalities ?? undefined) as Modality[] | undefined,
      contextWindow: userModel.contextWindow ?? undefined,
      maxOutputTokens: userModel.maxOutputTokens ?? undefined,
      endpointTypes: (userModel.endpointTypes ?? undefined) as EndpointType[] | undefined,
      supportsStreaming: userModel.supportsStreaming ?? true,
      reasoning: userModel.reasoning as RuntimeReasoning | undefined,
      isEnabled: userModel.isEnabled ?? true,
      isHidden: userModel.isHidden ?? false
    }
  }

  // Case 2: Preset model (may have catalog override and user override)
  if (!presetModel) {
    throw new Error('Preset model not found for merge')
  }

  const modelId = presetModel.id

  // Start from preset
  let capabilities: ModelCapability[] = [...presetModel.capabilities]
  let inputModalities: Modality[] | undefined = presetModel.inputModalities.length
    ? [...presetModel.inputModalities]
    : undefined
  let outputModalities: Modality[] | undefined = presetModel.outputModalities.length
    ? [...presetModel.outputModalities]
    : undefined
  let endpointTypes: EndpointType[] | undefined = undefined
  let name = presetModel.name ?? presetModel.id
  let description = presetModel.description
  let contextWindow = presetModel.contextWindow
  let maxOutputTokens = presetModel.maxOutputTokens
  let maxInputTokens = presetModel.maxInputTokens
  let reasoning: RuntimeReasoning | undefined
  let pricing: RuntimeModelPricing | undefined
  let replaceWith: string | undefined

  // Extract reasoning config from proto Reasoning type
  if (presetModel.reasoning) {
    reasoning = extractRuntimeReasoning(presetModel.reasoning)
  }

  // Extract pricing
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

  // Apply catalog override
  if (catalogOverride) {
    if (catalogOverride.capabilities) {
      capabilities = applyCapabilityOverride(capabilities, catalogOverride.capabilities)
    }
    if (catalogOverride.limits?.contextWindow != null) {
      contextWindow = catalogOverride.limits.contextWindow
    }
    if (catalogOverride.limits?.maxOutputTokens != null) {
      maxOutputTokens = catalogOverride.limits.maxOutputTokens
    }
    if (catalogOverride.limits?.maxInputTokens != null) {
      maxInputTokens = catalogOverride.limits.maxInputTokens
    }
    if (catalogOverride.reasoning) {
      const overrideReasoning = extractRuntimeReasoning(catalogOverride.reasoning)
      reasoning = {
        ...overrideReasoning,
        thinkingTokenLimits: overrideReasoning.thinkingTokenLimits ?? reasoning?.thinkingTokenLimits,
        interleaved: overrideReasoning.interleaved ?? reasoning?.interleaved
      }
    }
    if (catalogOverride.endpointTypes.length) {
      endpointTypes = [...catalogOverride.endpointTypes]
    }
    if (catalogOverride.inputModalities.length) {
      inputModalities = [...catalogOverride.inputModalities]
    }
    if (catalogOverride.outputModalities.length) {
      outputModalities = [...catalogOverride.outputModalities]
    }
    if (catalogOverride.replaceWith) {
      replaceWith = catalogOverride.replaceWith
    }
  }

  // Apply user override
  if (userModel) {
    if (userModel.capabilities) {
      capabilities = [...userModel.capabilities] as ModelCapability[]
    }
    if (userModel.endpointTypes) {
      endpointTypes = [...userModel.endpointTypes] as EndpointType[]
    }
    if (userModel.inputModalities) {
      inputModalities = [...userModel.inputModalities] as Modality[]
    }
    if (userModel.outputModalities) {
      outputModalities = [...userModel.outputModalities] as Modality[]
    }
    if (userModel.name) {
      name = userModel.name
    }
    if (userModel.description) {
      description = userModel.description
    }
    if (userModel.contextWindow != null) {
      contextWindow = userModel.contextWindow
    }
    if (userModel.maxOutputTokens != null) {
      maxOutputTokens = userModel.maxOutputTokens
    }
    if (userModel.reasoning) {
      reasoning = userModel.reasoning as RuntimeReasoning
    }
  }

  return {
    id: createUniqueModelId(providerId, modelId),
    providerId,
    // Use api_model_id from catalog override if available, otherwise fall back to model id
    apiModelId: catalogOverride?.apiModelId,
    name,
    description,
    group: userModel?.group ?? undefined,
    family: presetModel.family,
    ownedBy: presetModel.ownedBy,
    capabilities,
    inputModalities,
    outputModalities,
    contextWindow,
    maxOutputTokens,
    maxInputTokens,
    endpointTypes,
    supportsStreaming: userModel?.supportsStreaming ?? true,
    reasoning,
    pricing,
    isEnabled: userModel?.isEnabled ?? !(catalogOverride?.disabled ?? false),
    isHidden: userModel?.isHidden ?? false,
    replaceWith: replaceWith ? createUniqueModelId(providerId, replaceWith) : undefined
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Merge Utilities
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Merge provider configurations
 *
 * Priority: userProvider > presetProvider
 *
 * @param userProvider - User provider from SQLite (or null)
 * @param presetProvider - Preset provider from catalog (or null)
 * @returns Merged Provider
 */
export function mergeProviderConfig(
  userProvider: UserProviderRow | null,
  presetProvider: ProtoProviderConfig | null
): Provider {
  if (!userProvider && !presetProvider) {
    throw new Error('At least one of userProvider or presetProvider must be provided')
  }

  const providerId = userProvider?.providerId ?? presetProvider!.id

  // Merge baseUrls — proto uses map<int32, string>, convert to Record<string, string>
  const presetBaseUrls: Record<string, string> = {}
  if (presetProvider?.baseUrls) {
    for (const [k, v] of Object.entries(presetProvider.baseUrls)) {
      presetBaseUrls[k] = v
    }
  }
  const baseUrls: Record<string, string> = {
    ...presetBaseUrls,
    ...userProvider?.baseUrls
  }

  // Merge API features (catalog now uses the same field names)
  const apiCompatibility: RuntimeApiCompatibility = {
    ...DEFAULT_API_COMPATIBILITY,
    ...presetProvider?.apiCompatibility,
    ...userProvider?.apiCompatibility
  }

  // Merge settings
  const settings: ProviderSettings = {
    ...DEFAULT_PROVIDER_SETTINGS,
    ...userProvider?.providerSettings
  }

  // Process API keys (strip actual key values for security)
  const apiKeys =
    userProvider?.apiKeys?.map((k) => ({
      id: k.id,
      label: k.label,
      isEnabled: k.isEnabled,
      createdAt: Date.now()
    })) ?? []

  // Determine auth type
  let authType: Provider['authType'] = 'api-key'
  if (userProvider?.authConfig?.type) {
    authType = userProvider.authConfig.type as Provider['authType']
  }

  return {
    id: providerId,
    presetProviderId: userProvider?.presetProviderId ?? undefined,
    name: userProvider?.name ?? presetProvider?.name ?? providerId,
    description: presetProvider?.description,
    baseUrls,
    defaultChatEndpoint: userProvider?.defaultChatEndpoint ?? presetProvider?.defaultChatEndpoint,
    apiKeys,
    authType,
    apiCompatibility,
    settings,
    isEnabled: userProvider?.isEnabled ?? true
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════════

/** Map proto Reasoning.params.case to runtime reasoning type string */
const CASE_TO_TYPE: Record<string, string> = {
  openaiChat: 'openai-chat',
  openaiResponses: 'openai-responses',
  anthropic: 'anthropic',
  gemini: 'gemini',
  openrouter: 'openrouter',
  qwen: 'qwen',
  doubao: 'doubao',
  dashscope: 'dashscope',
  selfHosted: 'self-hosted'
}

/** Default effort levels per reasoning type (when not specified in catalog) */
const DEFAULT_EFFORTS: Record<string, ReasoningEffortType[]> = {
  'openai-chat': [
    ReasoningEffort.NONE,
    ReasoningEffort.MINIMAL,
    ReasoningEffort.LOW,
    ReasoningEffort.MEDIUM,
    ReasoningEffort.HIGH
  ],
  'openai-responses': [
    ReasoningEffort.NONE,
    ReasoningEffort.MINIMAL,
    ReasoningEffort.LOW,
    ReasoningEffort.MEDIUM,
    ReasoningEffort.HIGH
  ],
  anthropic: [],
  gemini: [ReasoningEffort.LOW, ReasoningEffort.MEDIUM, ReasoningEffort.HIGH],
  qwen: [],
  doubao: []
}

/**
 * Convert proto Reasoning message to runtime RuntimeReasoning
 */
function extractRuntimeReasoning(reasoning: ProtoReasoning): RuntimeReasoning {
  const type = CASE_TO_TYPE[reasoning.params.case ?? ''] ?? ''
  const common = reasoning.common

  // Get supported efforts from common, with fallback
  let supportedEfforts: ReasoningEffortType[] = common?.supportedEfforts ?? []
  if (supportedEfforts.length === 0) {
    supportedEfforts = DEFAULT_EFFORTS[type] ?? []
  }

  return {
    type,
    supportedEfforts,
    thinkingTokenLimits: common?.thinkingTokenLimits,
    interleaved: common?.interleaved
  }
}
