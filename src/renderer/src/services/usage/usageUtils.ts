import type { Model, ModelPricing, UsageCategory, UsagePricingSnapshot } from '@renderer/types'

const DEFAULT_CURRENCY_SYMBOL = '$'

export const buildPricingSnapshot = (
  pricing?: ModelPricing,
  unit: UsagePricingSnapshot['unit'] = 'per_million_tokens'
): UsagePricingSnapshot | undefined => {
  if (!pricing) {
    return undefined
  }

  return {
    input_per_million_tokens: pricing.input_per_million_tokens ?? 0,
    output_per_million_tokens: pricing.output_per_million_tokens ?? 0,
    currencySymbol: pricing.currencySymbol,
    unit
  }
}

export const getCurrencySymbol = (currencySymbol?: string) => {
  return currencySymbol || DEFAULT_CURRENCY_SYMBOL
}

export const calculatePricingCost = (
  params: { promptTokens?: number; completionTokens?: number },
  snapshot?: UsagePricingSnapshot
): number | undefined => {
  if (!snapshot) {
    return undefined
  }

  const inputTokens = params.promptTokens ?? 0
  const outputTokens = params.completionTokens ?? 0
  const inputRate = snapshot.input_per_million_tokens ?? 0
  const outputRate = snapshot.output_per_million_tokens ?? 0

  if (inputRate === 0 && outputRate === 0) {
    return 0
  }

  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000
}

export const calculateImageCost = (params: { imageCount: number; price?: number; unit?: number }) => {
  const unit = params.unit && params.unit > 0 ? params.unit : 1
  if (!params.price || params.imageCount <= 0) {
    return undefined
  }

  return (params.imageCount / unit) * params.price
}

export const getUsageCategoryForModel = (model?: Model): UsageCategory | undefined => {
  if (!model) {
    return undefined
  }

  if (model.endpoint_type === 'image-generation') {
    return 'image_generation'
  }

  const capabilityTypes = model.capabilities?.map((cap) => cap.type) || []
  const legacyTypes = model.type || []

  if (capabilityTypes.includes('vision') || legacyTypes.includes('vision')) {
    return 'multimodal'
  }

  if (capabilityTypes.includes('embedding') || legacyTypes.includes('embedding') || model.group === 'embedding') {
    return 'embedding'
  }

  if (capabilityTypes.includes('rerank') || legacyTypes.includes('rerank')) {
    return 'rerank'
  }

  if (capabilityTypes.includes('web_search') || legacyTypes.includes('web_search')) {
    return 'web_search'
  }

  return 'language'
}
