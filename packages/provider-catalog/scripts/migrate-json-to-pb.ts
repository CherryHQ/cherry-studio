/**
 * One-time migration: JSON data files → protobuf binary files
 *
 * Reads: data/models.json, data/providers.json, data/provider-models.json
 * Writes: data/models.pb, data/providers.pb, data/provider-models.pb
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { create, toBinary } from '@bufbuild/protobuf'

import type { Metadata, PricePerToken } from '../src/gen/v1/common_pb'
import { MetadataSchema, NumericRangeSchema, PricePerTokenSchema } from '../src/gen/v1/common_pb'
import type { ModelConfig, ModelPricing, Reasoning } from '../src/gen/v1/model_pb'
import {
  AnthropicReasoningParamsSchema,
  DashscopeReasoningParamsSchema,
  DoubaoReasoningParamsSchema,
  GeminiReasoningParamsSchema,
  ImagePriceSchema,
  MinutePriceSchema,
  ModelCatalogSchema,
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
} from '../src/gen/v1/model_pb'
import type { ProviderModelOverride } from '../src/gen/v1/provider_models_pb'
import {
  CapabilityOverrideSchema,
  ModelLimitsSchema,
  ProviderModelCatalogSchema,
  ProviderModelOverrideSchema
} from '../src/gen/v1/provider_models_pb'
import type { ProviderConfig } from '../src/gen/v1/provider_pb'
import {
  ApiCompatibilitySchema,
  ModelsApiUrlsSchema,
  ProviderCatalogSchema,
  ProviderConfigSchema,
  ProviderWebsiteSchema
} from '../src/gen/v1/provider_pb'
import { toCapability, toCurrency, toEndpointType, toModality, toReasoningEffort } from '../src/proto-utils'

const DATA_DIR = resolve(__dirname, '../data')

// ═══════════════════════════════════════════════════════════════════════════════
// Shared converters
// ═══════════════════════════════════════════════════════════════════════════════

// biome-ignore lint/suspicious/noExplicitAny: JSON data is untyped
function convertPricePerToken(json: any): PricePerToken | undefined {
  if (!json) return undefined
  return create(PricePerTokenSchema, {
    perMillionTokens: json.perMillionTokens ?? undefined,
    currency: toCurrency(json.currency)
  })
}

// biome-ignore lint/suspicious/noExplicitAny: JSON data is untyped
function convertMetadata(json: any): Metadata | undefined {
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
function convertPricing(json: any): ModelPricing | undefined {
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
function convertReasoning(json: any): Reasoning | undefined {
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

  // Set the oneof params based on type
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
function convertParameterSupport(json: any) {
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
// Model converter
// ═══════════════════════════════════════════════════════════════════════════════

// biome-ignore lint/suspicious/noExplicitAny: JSON data is untyped
function convertModelConfig(json: any): ModelConfig {
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

// ═══════════════════════════════════════════════════════════════════════════════
// Provider converter
// ═══════════════════════════════════════════════════════════════════════════════

// biome-ignore lint/suspicious/noExplicitAny: JSON data is untyped
function convertProviderConfig(json: any): ProviderConfig {
  // Convert baseUrls: Record<string, string> → map<int32, string>
  const baseUrls: Record<number, string> = {}
  if (json.baseUrls) {
    for (const [key, value] of Object.entries(json.baseUrls)) {
      const enumVal = toEndpointType(key)
      if (enumVal !== 0) {
        baseUrls[enumVal] = value as string
      }
    }
  }

  // Extract website from metadata
  const websiteData = json.metadata?.website
  const website = websiteData
    ? create(ProviderWebsiteSchema, {
        official: websiteData.official ?? undefined,
        docs: websiteData.docs ?? undefined,
        apiKey: websiteData.apiKey ?? undefined,
        models: websiteData.models ?? undefined
      })
    : undefined

  // Build metadata without the website field (it's now a separate field)
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

// ═══════════════════════════════════════════════════════════════════════════════
// Provider Model Override converter
// ═══════════════════════════════════════════════════════════════════════════════

// biome-ignore lint/suspicious/noExplicitAny: JSON data is untyped
function convertProviderModelOverride(json: any): ProviderModelOverride {
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

// ═══════════════════════════════════════════════════════════════════════════════
// Main migration logic
// ═══════════════════════════════════════════════════════════════════════════════

function migrateModels(): void {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, 'models.json'), 'utf-8'))
  console.log(`Read ${raw.models.length} models from models.json`)

  const catalog = create(ModelCatalogSchema, {
    version: raw.version,
    models: raw.models.map(convertModelConfig)
  })

  const bytes = toBinary(ModelCatalogSchema, catalog)
  writeFileSync(resolve(DATA_DIR, 'models.pb'), bytes)
  console.log(`Wrote models.pb (${bytes.length} bytes, ${(bytes.length / 1024).toFixed(1)}KB)`)
}

function migrateProviders(): void {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, 'providers.json'), 'utf-8'))
  console.log(`Read ${raw.providers.length} providers from providers.json`)

  const catalog = create(ProviderCatalogSchema, {
    version: raw.version,
    providers: raw.providers.map(convertProviderConfig)
  })

  const bytes = toBinary(ProviderCatalogSchema, catalog)
  writeFileSync(resolve(DATA_DIR, 'providers.pb'), bytes)
  console.log(`Wrote providers.pb (${bytes.length} bytes, ${(bytes.length / 1024).toFixed(1)}KB)`)
}

function migrateProviderModels(): void {
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, 'provider-models.json'), 'utf-8'))
  console.log(`Read ${raw.overrides.length} overrides from provider-models.json`)

  const catalog = create(ProviderModelCatalogSchema, {
    version: raw.version,
    overrides: raw.overrides.map(convertProviderModelOverride)
  })

  const bytes = toBinary(ProviderModelCatalogSchema, catalog)
  writeFileSync(resolve(DATA_DIR, 'provider-models.pb'), bytes)
  console.log(`Wrote provider-models.pb (${bytes.length} bytes, ${(bytes.length / 1024).toFixed(1)}KB)`)
}

// --- Run ---
console.log('Starting JSON → Protobuf migration...\n')
migrateModels()
migrateProviders()
migrateProviderModels()
console.log('\nMigration complete!')
