/**
 * Model and Provider configuration merging utilities
 *
 * These utilities merge configurations from different sources with
 * the correct priority order.
 */

import type {
  EndpointType,
  Modality,
  ModelConfig,
  ProviderConfig,
  ProviderModelOverride
} from '@cherrystudio/provider-catalog'
import type { ModelCapability } from '@cherrystudio/provider-catalog'
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

export type {
  ModelConfig as CatalogModel,
  ProviderModelOverride as CatalogProviderModelOverride
} from '@cherrystudio/provider-catalog'

export { DEFAULT_API_COMPATIBILITY, DEFAULT_PROVIDER_SETTINGS }

/**
 * Apply capability override to a base capability list
 *
 * @param base - Base capability list
 * @param override - Override operations (add/remove/force)
 * @returns Merged capability list
 */
export function applyCapabilityOverride(
  base: string[],
  override: { add?: string[]; remove?: string[]; force?: string[] } | null | undefined
): string[] {
  if (!override) {
    return [...base]
  }

  // Force completely replaces the base
  if (override.force && override.force.length > 0) {
    return [...override.force]
  }

  let result = [...base]

  // Add new capabilities
  if (override.add) {
    result = Array.from(new Set([...result, ...override.add]))
  }

  // Remove capabilities
  if (override.remove) {
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
  defaultChatEndpoint: z.string().nullish(),
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
  catalogOverride: ProviderModelOverride | null,
  presetModel: ModelConfig | null,
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
    throw new Error(`Preset model not found for merge`)
  }

  const modelId = presetModel.id

  // Start from preset
  let capabilities: string[] = [...(presetModel.capabilities ?? [])]
  let inputModalities: string[] | undefined = presetModel.inputModalities ? [...presetModel.inputModalities] : undefined
  let outputModalities: string[] | undefined = presetModel.outputModalities
    ? [...presetModel.outputModalities]
    : undefined
  let endpointTypes: string[] | undefined = undefined
  let name = presetModel.name ?? presetModel.id
  let description = presetModel.description
  let contextWindow = presetModel.contextWindow
  let maxOutputTokens = presetModel.maxOutputTokens
  let maxInputTokens = presetModel.maxInputTokens
  let reasoning: RuntimeReasoning | undefined
  let pricing: RuntimeModelPricing | undefined
  let replaceWith: string | undefined

  // Extract reasoning config
  if (presetModel.reasoning) {
    reasoning = {
      type: presetModel.reasoning.type,
      supportedEfforts: extractEfforts(presetModel.reasoning),
      thinkingTokenLimits: presetModel.reasoning.thinkingTokenLimits,
      interleaved: presetModel.reasoning.interleaved
    }
  }

  // Extract pricing
  if (presetModel.pricing) {
    pricing = {
      input: {
        perMillionTokens: presetModel.pricing.input.perMillionTokens,
        currency: presetModel.pricing.input.currency ?? 'USD'
      },
      output: {
        perMillionTokens: presetModel.pricing.output.perMillionTokens,
        currency: presetModel.pricing.output.currency ?? 'USD'
      },
      cacheRead: presetModel.pricing.cacheRead
        ? {
            perMillionTokens: presetModel.pricing.cacheRead.perMillionTokens,
            currency: presetModel.pricing.cacheRead.currency ?? 'USD'
          }
        : undefined,
      cacheWrite: presetModel.pricing.cacheWrite
        ? {
            perMillionTokens: presetModel.pricing.cacheWrite.perMillionTokens,
            currency: presetModel.pricing.cacheWrite.currency ?? 'USD'
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
      reasoning = {
        type: catalogOverride.reasoning.type,
        supportedEfforts: extractEfforts(catalogOverride.reasoning),
        thinkingTokenLimits:
          catalogOverride.reasoning.thinkingTokenLimits ?? presetModel.reasoning?.thinkingTokenLimits,
        interleaved: catalogOverride.reasoning.interleaved ?? presetModel.reasoning?.interleaved
      }
    }
    if (catalogOverride.endpointTypes) {
      endpointTypes = [...catalogOverride.endpointTypes]
    }
    if (catalogOverride.inputModalities) {
      inputModalities = [...catalogOverride.inputModalities]
    }
    if (catalogOverride.outputModalities) {
      outputModalities = [...catalogOverride.outputModalities]
    }
    if (catalogOverride.replaceWith) {
      replaceWith = catalogOverride.replaceWith
    }
  }

  // Apply user override
  if (userModel) {
    if (userModel.capabilities) {
      capabilities = [...userModel.capabilities]
    }
    if (userModel.endpointTypes) {
      endpointTypes = [...userModel.endpointTypes]
    }
    if (userModel.inputModalities) {
      inputModalities = [...userModel.inputModalities]
    }
    if (userModel.outputModalities) {
      outputModalities = [...userModel.outputModalities]
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
    capabilities: capabilities as ModelCapability[],
    inputModalities: inputModalities as Modality[] | undefined,
    outputModalities: outputModalities as Modality[] | undefined,
    contextWindow,
    maxOutputTokens,
    maxInputTokens,
    endpointTypes: endpointTypes as EndpointType[] | undefined,
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
  presetProvider: ProviderConfig | null
): Provider {
  if (!userProvider && !presetProvider) {
    throw new Error('At least one of userProvider or presetProvider must be provided')
  }

  const providerId = userProvider?.providerId ?? presetProvider!.id

  // Merge baseUrls
  const baseUrls: Record<string, string> = {
    ...presetProvider?.baseUrls,
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

/**
 * Extract effort levels from reasoning config
 *
 * Priority: explicit supported_efforts > fallback by type
 */
function extractEfforts(reasoning: { type: string; params?: object; supportedEfforts?: string[] }): string[] {
  // Prefer explicit supportedEfforts from catalog data
  if (reasoning.supportedEfforts && reasoning.supportedEfforts.length > 0) {
    return reasoning.supportedEfforts
  }

  // Fallback: infer default efforts by reasoning type
  const defaultEfforts: Record<string, string[]> = {
    'openai-chat': ['none', 'minimal', 'low', 'medium', 'high'],
    'openai-responses': ['none', 'minimal', 'low', 'medium', 'high'],
    anthropic: ['enabled', 'disabled'],
    gemini: ['low', 'medium', 'high'],
    qwen: ['enabled', 'disabled'],
    doubao: ['enabled', 'disabled', 'auto']
  }

  return defaultEfforts[reasoning.type] ?? []
}
