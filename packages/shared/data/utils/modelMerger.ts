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
  ProtoReasoningSupport
} from '@cherrystudio/provider-registry'
import type { Modality, ModelCapability, ReasoningEffort as ReasoningEffortType } from '@cherrystudio/provider-registry'
import { EndpointType, objectValues, ReasoningEffort } from '@cherrystudio/provider-registry'
import * as z from 'zod'

import type { Model, RuntimeModelPricing, RuntimeReasoning } from '../types/model'
import { createUniqueModelId } from '../types/model'
import type {
  EndpointConfig,
  Provider,
  ProviderSettings,
  ReasoningFormatType,
  RuntimeApiFeatures
} from '../types/provider'
import {
  ApiFeaturesSchema,
  ApiKeyEntrySchema,
  DEFAULT_API_FEATURES,
  DEFAULT_PROVIDER_SETTINGS,
  EndpointConfigSchema,
  ProviderSettingsSchema
} from '../types/provider'

export type { ProtoModelConfig as CatalogModel, ProtoProviderModelOverride as CatalogProviderModelOverride }

export { DEFAULT_API_FEATURES, DEFAULT_PROVIDER_SETTINGS }

/**
 * Apply capability override to a base capability list
 *
 * @param base - Base capability list
 * @param override - Override operations (add/remove/force)
 * @returns Merged capability list
 */
export function applyCapabilityOverride(
  base: ModelCapability[],
  override: { add?: ModelCapability[]; remove?: ModelCapability[]; force?: ModelCapability[] } | null | undefined
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
  if (override.add?.length) {
    result = Array.from(new Set([...result, ...override.add]))
  }

  // Remove capabilities
  if (override.remove?.length) {
    const removeSet = new Set(override.remove)
    result = result.filter((c) => !removeSet.has(c))
  }

  return result
}

const UserProviderRowSchema = z.object({
  providerId: z.string(),
  presetProviderId: z.string().nullish(),
  name: z.string(),
  endpointConfigs: z.record(z.string(), EndpointConfigSchema).nullish(),
  defaultChatEndpoint: z.enum(objectValues(EndpointType)).nullish(),
  apiKeys: z.array(ApiKeyEntrySchema.pick({ id: true, key: true, label: true, isEnabled: true })).nullish(),
  authConfig: z.object({ type: z.string() }).catchall(z.unknown()).nullish(),
  apiFeatures: ApiFeaturesSchema.nullish(),
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
  capabilities: z.array(z.string()).nullish(),
  inputModalities: z.array(z.string()).nullish(),
  outputModalities: z.array(z.string()).nullish(),
  endpointTypes: z.array(z.string()).nullish(),
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
  providerId: string,
  reasoningFormatTypes?: Partial<Record<EndpointType, ReasoningFormatType>> | null,
  defaultChatEndpoint?: EndpointType
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
  let capabilities: ModelCapability[] = [...(presetModel.capabilities ?? [])]
  let inputModalities: Modality[] | undefined = presetModel.inputModalities?.length
    ? [...presetModel.inputModalities]
    : undefined
  let outputModalities: Modality[] | undefined = presetModel.outputModalities?.length
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
    if (catalogOverride.endpointTypes?.length) {
      endpointTypes = [...catalogOverride.endpointTypes]
    }
    if (catalogOverride.inputModalities?.length) {
      inputModalities = [...catalogOverride.inputModalities]
    }
    if (catalogOverride.outputModalities?.length) {
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
  }

  const reasoningFormatType = resolveReasoningFormatType(endpointTypes, defaultChatEndpoint, reasoningFormatTypes)

  // Extract reasoning config from proto ReasoningSupport + provider's reasoning format type
  if (presetModel.reasoning) {
    reasoning = extractRuntimeReasoning(presetModel.reasoning, reasoningFormatType)
  }

  if (catalogOverride?.reasoning) {
    const overrideReasoning = extractRuntimeReasoning(catalogOverride.reasoning, reasoningFormatType)
    reasoning = {
      ...overrideReasoning,
      thinkingTokenLimits: overrideReasoning.thinkingTokenLimits ?? reasoning?.thinkingTokenLimits,
      interleaved: overrideReasoning.interleaved ?? reasoning?.interleaved
    }
  }

  if (userModel) {
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

  // Merge endpointConfigs — build from preset then overlay user config
  const presetEndpointConfigs = buildPresetEndpointConfigs(presetProvider)
  const endpointConfigs = mergeEndpointConfigs(presetEndpointConfigs, userProvider?.endpointConfigs)

  // Merge API features (catalog now uses the same field names)
  const apiFeatures: RuntimeApiFeatures = {
    ...DEFAULT_API_FEATURES,
    ...presetProvider?.apiFeatures,
    ...userProvider?.apiFeatures
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
      isEnabled: k.isEnabled
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
    endpointConfigs: Object.keys(endpointConfigs).length > 0 ? endpointConfigs : undefined,
    defaultChatEndpoint: userProvider?.defaultChatEndpoint ?? presetProvider?.defaultChatEndpoint,
    apiKeys,
    authType,
    apiFeatures,
    settings,
    isEnabled: userProvider?.isEnabled ?? true
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════════

const CHAT_REASONING_ENDPOINT_PRIORITY: EndpointType[] = [
  EndpointType.OPENAI_RESPONSES,
  EndpointType.OPENAI_CHAT_COMPLETIONS,
  EndpointType.ANTHROPIC_MESSAGES,
  EndpointType.GOOGLE_GENERATE_CONTENT,
  EndpointType.OLLAMA_CHAT,
  EndpointType.OLLAMA_GENERATE,
  EndpointType.OPENAI_TEXT_COMPLETIONS
]

/** Default effort levels per reasoning format type (when not specified in catalog) */
const DEFAULT_EFFORTS: Partial<Record<ReasoningFormatType, ReasoningEffortType[]>> = {
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
  'enable-thinking': [ReasoningEffort.NONE, ReasoningEffort.LOW, ReasoningEffort.MEDIUM, ReasoningEffort.HIGH],
  'thinking-type': [ReasoningEffort.NONE, ReasoningEffort.AUTO]
}

function isChatReasoningEndpointType(endpointType: EndpointType): boolean {
  return CHAT_REASONING_ENDPOINT_PRIORITY.includes(endpointType)
}

/**
 * Build runtime endpointConfigs from preset provider's registry data.
 * Maps registry reasoningFormat (discriminated union) to runtime reasoningFormatType string.
 */
function buildPresetEndpointConfigs(
  presetProvider: ProtoProviderConfig | null
): Partial<Record<EndpointType, EndpointConfig>> {
  if (!presetProvider?.endpointConfigs) return {}

  const configs: Partial<Record<EndpointType, EndpointConfig>> = {}

  for (const [k, regConfig] of Object.entries(presetProvider.endpointConfigs)) {
    const ep = k as EndpointType
    const config: EndpointConfig = {}

    if (regConfig.baseUrl) config.baseUrl = regConfig.baseUrl
    if (regConfig.modelsApiUrls) config.modelsApiUrls = regConfig.modelsApiUrls
    if (regConfig.reasoningFormat?.type)
      config.reasoningFormatType = regConfig.reasoningFormat.type as ReasoningFormatType

    if (Object.keys(config).length > 0) {
      configs[ep] = config
    }
  }

  return configs
}

/**
 * Deep-merge two endpointConfigs. User config takes priority per field within each endpoint.
 */
function mergeEndpointConfigs(
  preset: Partial<Record<EndpointType, EndpointConfig>> | null | undefined,
  user: Partial<Record<EndpointType, EndpointConfig>> | null | undefined
): Partial<Record<EndpointType, EndpointConfig>> {
  const result: Partial<Record<EndpointType, EndpointConfig>> = {}

  const allKeys = new Set([...Object.keys(preset ?? {}), ...Object.keys(user ?? {})])

  for (const k of allKeys) {
    const endpointType = k as EndpointType
    const presetConfig = preset?.[endpointType]
    const userConfig = user?.[endpointType]
    result[endpointType] = {
      ...presetConfig,
      ...userConfig
    }
  }

  return result
}

/**
 * Extract reasoningFormatTypes map from endpointConfigs (for backward-compatible access)
 */
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

/**
 * Convert proto ReasoningSupport to runtime RuntimeReasoning
 * The `type` comes from the provider's reasoningFormat, not from the model.
 */
function extractRuntimeReasoning(
  reasoning: ProtoReasoningSupport,
  reasoningFormatType: ReasoningFormatType | undefined
): RuntimeReasoning {
  const type = reasoningFormatType ?? ''

  // Get supported efforts, with fallback based on provider format type
  let supportedEfforts: ReasoningEffortType[] = [...(reasoning.supportedEfforts ?? [])]
  if (supportedEfforts.length === 0) {
    supportedEfforts = DEFAULT_EFFORTS[type] ?? []
  }

  return {
    type,
    supportedEfforts,
    thinkingTokenLimits: reasoning.thinkingTokenLimits,
    interleaved: reasoning.interleaved
  }
}
