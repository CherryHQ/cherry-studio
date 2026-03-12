/**
 * Converts plain JSON objects (with string enum values) to protobuf messages.
 * Extracted from migrate-json-to-pb.ts for reuse by pipeline scripts.
 */

import { create } from '@bufbuild/protobuf'

import type { Metadata, PricePerToken } from '../../src/gen/v1/common_pb'
import { MetadataSchema, NumericRangeSchema, PricePerTokenSchema } from '../../src/gen/v1/common_pb'
import type { ModelConfig, ModelPricing, Reasoning } from '../../src/gen/v1/model_pb'
import {
  AnthropicReasoningParamsSchema,
  DashscopeReasoningParamsSchema,
  DoubaoReasoningParamsSchema,
  GeminiReasoningParamsSchema,
  ImagePriceSchema,
  MinutePriceSchema,
  ModelConfigSchema,
  ModelPricingSchema,
  OpenAIChatReasoningParamsSchema,
  OpenAIResponsesReasoningParamsSchema,
  OpenRouterReasoningParamsSchema,
  ParameterSupportSchema,
  QwenReasoningParamsSchema,
  RangedParameterSupportSchema,
  ReasoningCommonSchema,
  ReasoningSchema,
  SelfHostedReasoningParamsSchema,
  ThinkingTokenLimitsSchema
} from '../../src/gen/v1/model_pb'
import type { ProviderModelOverride } from '../../src/gen/v1/provider_models_pb'
import {
  CapabilityOverrideSchema,
  ModelLimitsSchema,
  ProviderModelOverrideSchema
} from '../../src/gen/v1/provider_models_pb'
import type { ProviderConfig } from '../../src/gen/v1/provider_pb'
import {
  ApiCompatibilitySchema,
  ModelsApiUrlsSchema,
  ProviderConfigSchema,
  ProviderWebsiteSchema
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

// biome-ignore lint/suspicious/noExplicitAny: JSON data is untyped
export function convertReasoning(json: any): Reasoning | undefined {
  if (!json) return undefined

  const common = create(ReasoningCommonSchema, {
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

  const reasoning = create(ReasoningSchema, { common })

  switch (json.type) {
    case 'openai-chat':
      reasoning.params = { case: 'openaiChat', value: create(OpenAIChatReasoningParamsSchema) }
      break
    case 'openai-responses':
      reasoning.params = { case: 'openaiResponses', value: create(OpenAIResponsesReasoningParamsSchema) }
      break
    case 'anthropic':
      reasoning.params = { case: 'anthropic', value: create(AnthropicReasoningParamsSchema) }
      break
    case 'gemini':
      reasoning.params = { case: 'gemini', value: create(GeminiReasoningParamsSchema) }
      break
    case 'openrouter':
      reasoning.params = { case: 'openrouter', value: create(OpenRouterReasoningParamsSchema) }
      break
    case 'qwen':
      reasoning.params = { case: 'qwen', value: create(QwenReasoningParamsSchema) }
      break
    case 'doubao':
      reasoning.params = { case: 'doubao', value: create(DoubaoReasoningParamsSchema) }
      break
    case 'dashscope':
      reasoning.params = { case: 'dashscope', value: create(DashscopeReasoningParamsSchema) }
      break
    case 'self-hosted':
      reasoning.params = { case: 'selfHosted', value: create(SelfHostedReasoningParamsSchema) }
      break
  }

  return reasoning
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
    reasoning: convertReasoning(json.reasoning),
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
      const enumVal = toEndpointType(key)
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

  let metadata: Metadata | undefined
  if (json.metadata) {
    const metaCopy = { ...json.metadata }
    delete metaCopy.website
    metadata = convertMetadata(metaCopy)
  }

  return create(ProviderConfigSchema, {
    id: json.id,
    name: json.name,
    description: json.description ?? undefined,
    baseUrls,
    defaultChatEndpoint: json.defaultChatEndpoint ? toEndpointType(json.defaultChatEndpoint) : undefined,
    apiCompatibility: json.apiCompatibility
      ? create(ApiCompatibilitySchema, {
          arrayContent: json.apiCompatibility.arrayContent ?? undefined,
          streamOptions: json.apiCompatibility.streamOptions ?? undefined,
          developerRole: json.apiCompatibility.developerRole ?? undefined,
          serviceTier: json.apiCompatibility.serviceTier ?? undefined,
          verbosity: json.apiCompatibility.verbosity ?? undefined,
          enableThinking: json.apiCompatibility.enableThinking ?? undefined,
          requiresApiKey: json.apiCompatibility.requiresApiKey ?? undefined
        })
      : undefined,
    modelsApiUrls: json.modelsApiUrls
      ? create(ModelsApiUrlsSchema, {
          default: json.modelsApiUrls.default ?? undefined,
          embedding: json.modelsApiUrls.embedding ?? undefined,
          reranker: json.modelsApiUrls.reranker ?? undefined
        })
      : undefined,
    metadata,
    website
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
    reasoning: convertReasoning(json.reasoning),
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
