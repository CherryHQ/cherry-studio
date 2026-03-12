/**
 * Converts protobuf messages to plain JSON objects (with string enum values).
 * This is the reverse of json-to-proto.ts, used by pipeline scripts that
 * need to work with plain objects internally but read/write .pb files.
 */

import type { ModelConfig, ModelPricing, Reasoning } from '../../src/gen/v1/model_pb'
import type { ProviderModelOverride } from '../../src/gen/v1/provider_models_pb'
import type { ProviderConfig } from '../../src/gen/v1/provider_pb'
import {
  fromCapability,
  fromCurrency,
  fromEndpointType,
  fromModality,
  fromReasoningEffort
} from '../../src/proto-utils'

// Reasoning oneof case → type string (matches the JSON format)
const REASONING_CASE_TO_TYPE: Record<string, string> = {
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

// biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
function pricingToJson(pricing: ModelPricing | undefined): any {
  if (!pricing) return undefined
  // biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
  const result: any = {}
  if (pricing.input) {
    result.input = {
      perMillionTokens: pricing.input.perMillionTokens ?? undefined,
      currency: fromCurrency(pricing.input.currency)
    }
  }
  if (pricing.output) {
    result.output = {
      perMillionTokens: pricing.output.perMillionTokens ?? undefined,
      currency: fromCurrency(pricing.output.currency)
    }
  }
  if (pricing.cacheRead) {
    result.cacheRead = {
      perMillionTokens: pricing.cacheRead.perMillionTokens ?? undefined,
      currency: fromCurrency(pricing.cacheRead.currency)
    }
  }
  if (pricing.cacheWrite) {
    result.cacheWrite = {
      perMillionTokens: pricing.cacheWrite.perMillionTokens ?? undefined,
      currency: fromCurrency(pricing.cacheWrite.currency)
    }
  }
  if (pricing.perImage) {
    result.perImage = {
      price: pricing.perImage.price,
      currency: fromCurrency(pricing.perImage.currency),
      unit: pricing.perImage.unit === 2 ? 'pixel' : pricing.perImage.unit === 1 ? 'image' : undefined
    }
  }
  if (pricing.perMinute) {
    result.perMinute = {
      price: pricing.perMinute.price,
      currency: fromCurrency(pricing.perMinute.currency)
    }
  }
  return result
}

// biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
function reasoningToJson(reasoning: Reasoning | undefined): any {
  if (!reasoning) return undefined
  // biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
  const result: any = {}

  if (reasoning.params?.case) {
    result.type = REASONING_CASE_TO_TYPE[reasoning.params.case] ?? reasoning.params.case
  }

  if (reasoning.common) {
    if (reasoning.common.thinkingTokenLimits) {
      result.thinkingTokenLimits = {
        min: reasoning.common.thinkingTokenLimits.min ?? undefined,
        max: reasoning.common.thinkingTokenLimits.max ?? undefined,
        default: reasoning.common.thinkingTokenLimits.default ?? undefined
      }
    }
    if (reasoning.common.supportedEfforts?.length) {
      result.supportedEfforts = reasoning.common.supportedEfforts.map(fromReasoningEffort).filter(Boolean)
    }
    if (reasoning.common.interleaved !== undefined) {
      result.interleaved = reasoning.common.interleaved
    }
  }

  return result
}

// biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
function parameterSupportToJson(ps: any): any {
  if (!ps) return undefined
  // biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
  const result: any = {}
  if (ps.temperature) {
    result.temperature = {
      supported: ps.temperature.supported,
      ...(ps.temperature.range ? { range: { min: ps.temperature.range.min, max: ps.temperature.range.max } } : {})
    }
  }
  if (ps.topP) {
    result.topP = {
      supported: ps.topP.supported,
      ...(ps.topP.range ? { range: { min: ps.topP.range.min, max: ps.topP.range.max } } : {})
    }
  }
  if (ps.topK) {
    result.topK = {
      supported: ps.topK.supported,
      ...(ps.topK.range ? { range: { min: ps.topK.range.min, max: ps.topK.range.max } } : {})
    }
  }
  if (ps.frequencyPenalty !== undefined) result.frequencyPenalty = ps.frequencyPenalty
  if (ps.presencePenalty !== undefined) result.presencePenalty = ps.presencePenalty
  if (ps.maxTokens !== undefined) result.maxTokens = ps.maxTokens
  if (ps.stopSequences !== undefined) result.stopSequences = ps.stopSequences
  if (ps.systemMessage !== undefined) result.systemMessage = ps.systemMessage
  return result
}

// biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
function metadataToJson(metadata: any): any {
  if (!metadata?.entries) return undefined
  if (Object.keys(metadata.entries).length === 0) return undefined
  // biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
  const result: any = {}
  for (const [key, value] of Object.entries(metadata.entries)) {
    try {
      result[key] = JSON.parse(value as string)
    } catch {
      result[key] = value
    }
  }
  return result
}

// biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
export function protoModelToJson(model: ModelConfig): any {
  // biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
  const result: any = { id: model.id }
  if (model.name) result.name = model.name
  if (model.description) result.description = model.description
  if (model.capabilities.length) result.capabilities = model.capabilities.map(fromCapability).filter(Boolean)
  if (model.inputModalities.length) result.inputModalities = model.inputModalities.map(fromModality).filter(Boolean)
  if (model.outputModalities.length) result.outputModalities = model.outputModalities.map(fromModality).filter(Boolean)
  if (model.contextWindow) result.contextWindow = model.contextWindow
  if (model.maxOutputTokens) result.maxOutputTokens = model.maxOutputTokens
  if (model.maxInputTokens) result.maxInputTokens = model.maxInputTokens
  const pricing = pricingToJson(model.pricing)
  if (pricing) result.pricing = pricing
  const reasoning = reasoningToJson(model.reasoning)
  if (reasoning) result.reasoning = reasoning
  const ps = parameterSupportToJson(model.parameterSupport)
  if (ps) result.parameterSupport = ps
  if (model.family) result.family = model.family
  if (model.ownedBy) result.ownedBy = model.ownedBy
  if (model.openWeights !== undefined) result.openWeights = model.openWeights
  if (model.alias.length) result.alias = [...model.alias]
  const metadata = metadataToJson(model.metadata)
  if (metadata) result.metadata = metadata
  return result
}

// biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
export function protoProviderToJson(provider: ProviderConfig): any {
  // Convert baseUrls: map<int32, string> → Record<string, string>
  const baseUrls: Record<string, string> = {}
  for (const [key, value] of Object.entries(provider.baseUrls)) {
    const endpointStr = fromEndpointType(Number(key))
    if (endpointStr) baseUrls[endpointStr] = value
  }

  // Merge website back into metadata
  const metadata = metadataToJson(provider.metadata) ?? {}
  if (provider.website) {
    // biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
    const website: any = {}
    if (provider.website.official) website.official = provider.website.official
    if (provider.website.docs) website.docs = provider.website.docs
    if (provider.website.apiKey) website.apiKey = provider.website.apiKey
    if (provider.website.models) website.models = provider.website.models
    if (Object.keys(website).length) metadata.website = website
  }

  // biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
  const result: any = {
    id: provider.id,
    name: provider.name
  }
  if (provider.description) result.description = provider.description
  if (Object.keys(baseUrls).length) result.baseUrls = baseUrls
  if (provider.defaultChatEndpoint) result.defaultChatEndpoint = fromEndpointType(provider.defaultChatEndpoint)
  if (provider.apiCompatibility) {
    // biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
    const compat: any = {}
    if (provider.apiCompatibility.arrayContent !== undefined)
      compat.arrayContent = provider.apiCompatibility.arrayContent
    if (provider.apiCompatibility.streamOptions !== undefined)
      compat.streamOptions = provider.apiCompatibility.streamOptions
    if (provider.apiCompatibility.developerRole !== undefined)
      compat.developerRole = provider.apiCompatibility.developerRole
    if (provider.apiCompatibility.serviceTier !== undefined) compat.serviceTier = provider.apiCompatibility.serviceTier
    if (provider.apiCompatibility.verbosity !== undefined) compat.verbosity = provider.apiCompatibility.verbosity
    if (provider.apiCompatibility.enableThinking !== undefined)
      compat.enableThinking = provider.apiCompatibility.enableThinking
    if (provider.apiCompatibility.requiresApiKey !== undefined)
      compat.requiresApiKey = provider.apiCompatibility.requiresApiKey
    if (Object.keys(compat).length) result.apiCompatibility = compat
  }
  if (provider.modelsApiUrls) {
    // biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
    const urls: any = {}
    if (provider.modelsApiUrls.default) urls.default = provider.modelsApiUrls.default
    if (provider.modelsApiUrls.embedding) urls.embedding = provider.modelsApiUrls.embedding
    if (provider.modelsApiUrls.reranker) urls.reranker = provider.modelsApiUrls.reranker
    if (Object.keys(urls).length) result.modelsApiUrls = urls
  }
  if (Object.keys(metadata).length) result.metadata = metadata
  return result
}

// biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
export function protoOverrideToJson(override: ProviderModelOverride): any {
  // biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
  const result: any = {
    providerId: override.providerId,
    modelId: override.modelId,
    priority: override.priority ?? 0
  }
  if (override.apiModelId) result.apiModelId = override.apiModelId
  if (override.modelVariant) result.modelVariant = override.modelVariant
  if (override.capabilities) {
    // biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
    const caps: any = {}
    if (override.capabilities.add.length) caps.add = override.capabilities.add.map(fromCapability).filter(Boolean)
    if (override.capabilities.remove.length)
      caps.remove = override.capabilities.remove.map(fromCapability).filter(Boolean)
    if (override.capabilities.force.length) caps.force = override.capabilities.force.map(fromCapability).filter(Boolean)
    if (Object.keys(caps).length) result.capabilities = caps
  }
  if (override.limits) {
    // biome-ignore lint/suspicious/noExplicitAny: converting to untyped JSON
    const limits: any = {}
    if (override.limits.contextWindow) limits.contextWindow = override.limits.contextWindow
    if (override.limits.maxOutputTokens) limits.maxOutputTokens = override.limits.maxOutputTokens
    if (override.limits.maxInputTokens) limits.maxInputTokens = override.limits.maxInputTokens
    if (override.limits.rateLimit) limits.rateLimit = override.limits.rateLimit
    if (Object.keys(limits).length) result.limits = limits
  }
  const pricing = pricingToJson(override.pricing)
  if (pricing) result.pricing = pricing
  const reasoning = reasoningToJson(override.reasoning)
  if (reasoning) result.reasoning = reasoning
  const ps = parameterSupportToJson(override.parameterSupport)
  if (ps) result.parameterSupport = ps
  if (override.endpointTypes.length) result.endpointTypes = override.endpointTypes.map(fromEndpointType).filter(Boolean)
  if (override.inputModalities.length)
    result.inputModalities = override.inputModalities.map(fromModality).filter(Boolean)
  if (override.outputModalities.length)
    result.outputModalities = override.outputModalities.map(fromModality).filter(Boolean)
  if (override.disabled !== undefined) result.disabled = override.disabled
  if (override.replaceWith) result.replaceWith = override.replaceWith
  if (override.reason) result.reason = override.reason
  return result
}
