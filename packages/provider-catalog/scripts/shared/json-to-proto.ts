/**
 * Converts plain JSON objects (with string enum values) to protobuf messages.
 * Extracted from migrate-json-to-pb.ts for reuse by pipeline scripts.
 */

import { create } from '@bufbuild/protobuf'

import type { Metadata, PricePerToken } from '../../src/gen/v1/common_pb'
import { MetadataSchema, NumericRangeSchema, PricePerTokenSchema } from '../../src/gen/v1/common_pb'
import type { ModelConfig, ModelPricing, ReasoningSupport } from '../../src/gen/v1/model_pb'
import {
  ImagePriceSchema,
  MinutePriceSchema,
  ModelConfigSchema,
  ModelPricingSchema,
  ParameterSupportSchema,
  RangedParameterSupportSchema,
  ReasoningSupportSchema,
  ThinkingTokenLimitsSchema
} from '../../src/gen/v1/model_pb'
import type { ProviderModelOverride } from '../../src/gen/v1/provider_models_pb'
import {
  CapabilityOverrideSchema,
  ModelLimitsSchema,
  ProviderModelOverrideSchema
} from '../../src/gen/v1/provider_models_pb'
import type { ProviderConfig, ProviderReasoningFormat } from '../../src/gen/v1/provider_pb'
import {
  AnthropicReasoningFormatSchema,
  ApiFeaturesSchema,
  DashscopeReasoningFormatSchema,
  EnableThinkingReasoningFormatSchema,
  GeminiReasoningFormatSchema,
  ModelsApiUrlsSchema,
  OpenAIChatReasoningFormatSchema,
  OpenAIResponsesReasoningFormatSchema,
  OpenRouterReasoningFormatSchema,
  ProviderConfigSchema,
  ProviderMetadataSchema,
  ProviderReasoningFormatSchema,
  ProviderWebsiteSchema,
  SelfHostedReasoningFormatSchema,
  ThinkingTypeReasoningFormatSchema
} from '../../src/gen/v1/provider_pb'
import { toCapability, toCurrency, toEndpointType, toModality, toReasoningEffort } from '../../src/proto-utils'

// ═══════════════════════════════════════════════════════════════════════════════
// Shared converters
// ═══════════════════════════════════════════════════════════════════════════════

// biome-ignore lint/suspicious/noExplicitAny: JSON data is untyped
export function convertPricePerToken(json: any): PricePerToken | undefined {
  if (!json) return undefined
  return create(PricePerTokenSchema, {
    perMillionTokens: json.perMillionTokens ?? undefined,
    currency: toCurrency(json.currency)
  })
}

// biome-ignore lint/suspicious/noExplicitAny: JSON data is untyped
export function convertMetadata(json: any): Metadata | undefined {
  if (!json) return undefined
  const entries: Record<string, string> = {}
  for (const [key, value] of Object.entries(json)) {
    if (value !== null && value !== undefined) {
      entries[key] = typeof value === 'string' ? value : JSON.stringify(value)
    }
  }
  return create(MetadataSchema, { entries })
}

// biome-ignore lint/suspicious/noExplicitAny: JSON data is untyped
export function convertPricing(json: any): ModelPricing | undefined {
  if (!json) return undefined
  return create(ModelPricingSchema, {
    input: convertPricePerToken(json.input),
    output: convertPricePerToken(json.output),
    cacheRead: convertPricePerToken(json.cacheRead),
    cacheWrite: convertPricePerToken(json.cacheWrite),
    perImage: json.perImage
      ? create(ImagePriceSchema, {
          price: json.perImage.price ?? 0,
          currency: toCurrency(json.perImage.currency),
          unit: json.perImage.unit === 'pixel' ? 2 : json.perImage.unit === 'image' ? 1 : 0
        })
      : undefined,
    perMinute: json.perMinute
      ? create(MinutePriceSchema, {
          price: json.perMinute.price ?? 0,
          currency: toCurrency(json.perMinute.currency)
        })
      : undefined
  })
}

/**
 * Convert reasoning JSON to ReasoningSupport proto (model-level capabilities only).
 * The provider-specific type/params are now on the provider, not the model.
 */
// biome-ignore lint/suspicious/noExplicitAny: JSON data is untyped
export function convertReasoningSupport(json: any): ReasoningSupport | undefined {
  if (!json) return undefined

  return create(ReasoningSupportSchema, {
    thinkingTokenLimits: json.thinkingTokenLimits
      ? create(ThinkingTokenLimitsSchema, {
          min: json.thinkingTokenLimits.min ?? undefined,
          max: json.thinkingTokenLimits.max ?? undefined,
          default: json.thinkingTokenLimits.default ?? undefined
        })
      : undefined,
    supportedEfforts: (json.supportedEfforts ?? []).map(toReasoningEffort),
    interleaved: json.interleaved ?? undefined
  })
}

/**
 * Convert reasoning format JSON to ProviderReasoningFormat proto (provider-level).
 */
// biome-ignore lint/suspicious/noExplicitAny: JSON data is untyped
export function convertProviderReasoningFormat(json: any): ProviderReasoningFormat | undefined {
  if (!json?.type) return undefined

  const format = create(ProviderReasoningFormatSchema)

  switch (json.type) {
    case 'openai-chat':
      format.format = { case: 'openaiChat', value: create(OpenAIChatReasoningFormatSchema) }
      break
    case 'openai-responses':
      format.format = { case: 'openaiResponses', value: create(OpenAIResponsesReasoningFormatSchema) }
      break
    case 'anthropic':
      format.format = { case: 'anthropic', value: create(AnthropicReasoningFormatSchema) }
      break
    case 'gemini':
      format.format = { case: 'gemini', value: create(GeminiReasoningFormatSchema) }
      break
    case 'openrouter':
      format.format = { case: 'openrouter', value: create(OpenRouterReasoningFormatSchema) }
      break
    case 'enable-thinking':
      format.format = { case: 'enableThinking', value: create(EnableThinkingReasoningFormatSchema) }
      break
    case 'thinking-type':
      format.format = { case: 'thinkingType', value: create(ThinkingTypeReasoningFormatSchema) }
      break
    case 'dashscope':
      format.format = { case: 'dashscope', value: create(DashscopeReasoningFormatSchema) }
      break
    case 'self-hosted':
      format.format = { case: 'selfHosted', value: create(SelfHostedReasoningFormatSchema) }
      break
  }

  return format
}

// biome-ignore lint/suspicious/noExplicitAny: JSON data is untyped
export function convertParameterSupport(json: any) {
  if (!json) return undefined
  return create(ParameterSupportSchema, {
    temperature: json.temperature
      ? create(RangedParameterSupportSchema, {
          supported: json.temperature.supported ?? true,
          range: json.temperature.range
            ? create(NumericRangeSchema, { min: json.temperature.range.min, max: json.temperature.range.max })
            : undefined
        })
      : undefined,
    topP: json.topP
      ? create(RangedParameterSupportSchema, {
          supported: json.topP.supported ?? true,
          range: json.topP.range
            ? create(NumericRangeSchema, { min: json.topP.range.min, max: json.topP.range.max })
            : undefined
        })
      : undefined,
    topK: json.topK
      ? create(RangedParameterSupportSchema, {
          supported: json.topK.supported ?? true,
          range: json.topK.range
            ? create(NumericRangeSchema, { min: json.topK.range.min, max: json.topK.range.max })
            : undefined
        })
      : undefined,
    frequencyPenalty: json.frequencyPenalty ?? undefined,
    presencePenalty: json.presencePenalty ?? undefined,
    maxTokens: json.maxTokens ?? undefined,
    stopSequences: json.stopSequences ?? undefined,
    systemMessage: json.systemMessage ?? undefined
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Top-level converters
// ═══════════════════════════════════════════════════════════════════════════════

// biome-ignore lint/suspicious/noExplicitAny: JSON data is untyped
export function convertModelConfig(json: any): ModelConfig {
  return create(ModelConfigSchema, {
    id: json.id,
    name: json.name ?? undefined,
    description: json.description ?? undefined,
    capabilities: (json.capabilities ?? []).map(toCapability),
    inputModalities: (json.inputModalities ?? []).map(toModality),
    outputModalities: (json.outputModalities ?? []).map(toModality),
    contextWindow: json.contextWindow ?? undefined,
    maxOutputTokens: json.maxOutputTokens ?? undefined,
    maxInputTokens: json.maxInputTokens ?? undefined,
    pricing: convertPricing(json.pricing),
    reasoning: convertReasoningSupport(json.reasoning),
    parameterSupport: convertParameterSupport(json.parameterSupport),
    family: json.family ?? undefined,
    ownedBy: json.ownedBy ?? undefined,
    openWeights: json.openWeights ?? undefined,
    alias: json.alias ?? [],
    metadata: convertMetadata(json.metadata)
  })
}

// biome-ignore lint/suspicious/noExplicitAny: JSON data is untyped
export function convertProviderConfig(json: any): ProviderConfig {
  const baseUrls: Record<number, string> = {}
  if (json.baseUrls) {
    for (const [key, value] of Object.entries(json.baseUrls)) {
      const enumVal = /^\d+$/.test(key) ? Number(key) : toEndpointType(key)
      if (enumVal !== 0) {
        baseUrls[enumVal] = value as string
      }
    }
  }

  const websiteData = json.metadata?.website
  const website = websiteData
    ? create(ProviderWebsiteSchema, {
        official: websiteData.official ?? undefined,
        docs: websiteData.docs ?? undefined,
        apiKey: websiteData.apiKey ?? undefined,
        models: websiteData.models ?? undefined
      })
    : undefined

  // ProviderConfig.metadata is ProviderMetadata (wraps website)
  const providerMetadata = website ? create(ProviderMetadataSchema, { website }) : undefined

  return create(ProviderConfigSchema, {
    id: json.id,
    name: json.name,
    description: json.description ?? undefined,
    baseUrls,
    defaultChatEndpoint: json.defaultChatEndpoint
      ? typeof json.defaultChatEndpoint === 'number'
        ? json.defaultChatEndpoint
        : toEndpointType(json.defaultChatEndpoint)
      : undefined,
    apiFeatures: json.apiFeatures
      ? create(ApiFeaturesSchema, {
          arrayContent: json.apiFeatures.arrayContent ?? undefined,
          streamOptions: json.apiFeatures.streamOptions ?? undefined,
          developerRole: json.apiFeatures.developerRole ?? undefined,
          serviceTier: json.apiFeatures.serviceTier ?? undefined,
          verbosity: json.apiFeatures.verbosity ?? undefined,
          enableThinking: json.apiFeatures.enableThinking ?? undefined
        })
      : undefined,
    modelsApiUrls: json.modelsApiUrls
      ? create(ModelsApiUrlsSchema, {
          default: json.modelsApiUrls.default ?? undefined,
          embedding: json.modelsApiUrls.embedding ?? undefined,
          reranker: json.modelsApiUrls.reranker ?? undefined
        })
      : undefined,
    metadata: providerMetadata,
    reasoningFormat: convertProviderReasoningFormat(json.reasoningFormat)
  })
}

// biome-ignore lint/suspicious/noExplicitAny: JSON data is untyped
export function convertProviderModelOverride(json: any): ProviderModelOverride {
  return create(ProviderModelOverrideSchema, {
    providerId: json.providerId,
    modelId: json.modelId,
    apiModelId: json.apiModelId ?? undefined,
    modelVariant: json.modelVariant ?? undefined,
    capabilities: json.capabilities
      ? create(CapabilityOverrideSchema, {
          add: (json.capabilities.add ?? []).map(toCapability),
          remove: (json.capabilities.remove ?? []).map(toCapability),
          force: (json.capabilities.force ?? []).map(toCapability)
        })
      : undefined,
    limits: json.limits
      ? create(ModelLimitsSchema, {
          contextWindow: json.limits.contextWindow ?? undefined,
          maxOutputTokens: json.limits.maxOutputTokens ?? undefined,
          maxInputTokens: json.limits.maxInputTokens ?? undefined,
          rateLimit: json.limits.rateLimit ?? undefined
        })
      : undefined,
    pricing: convertPricing(json.pricing),
    reasoning: convertReasoningSupport(json.reasoning),
    parameterSupport: convertParameterSupport(json.parameterSupport),
    endpointTypes: (json.endpointTypes ?? []).map(toEndpointType),
    inputModalities: (json.inputModalities ?? []).map(toModality),
    outputModalities: (json.outputModalities ?? []).map(toModality),
    disabled: json.disabled ?? undefined,
    replaceWith: json.replaceWith ?? undefined,
    reason: json.reason ?? undefined,
    priority: json.priority ?? 0
  })
}
