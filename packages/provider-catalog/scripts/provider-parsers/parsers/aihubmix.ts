/**
 * AIHubMix parser adapter
 * Uses existing Zod schemas but outputs ProviderModelEntry format
 */

import type { AiHubMixModel } from '../../../src/utils/importers/aihubmix/types'
import { AiHubMixResponseSchema } from '../../../src/utils/importers/aihubmix/types'
import {
  extractParameterSize,
  extractVariantSuffix,
  normalizeModelId,
  normalizeVersionSeparators,
  stripVariantSuffixes
} from '../../../src/utils/importers/base/base-transformer'
import type { ProviderModelEntry } from '../types'

/**
 * Extract variant suffix and parameter size from model ID
 */
function extractVariantAndSize(id: string): { baseId: string; variant: string | null; parameterSize: string | null } {
  let baseId = id
  const variant = extractVariantSuffix(id) || null

  if (variant) {
    baseId = stripVariantSuffixes(id)
  }

  const normalizedBaseId = normalizeVersionSeparators(baseId.toLowerCase())
  const parameterSize = extractParameterSize(normalizedBaseId) || null

  return { baseId, variant, parameterSize }
}

/**
 * Check if model has reasoning capability based on features
 */
function hasReasoningCapability(features: string): boolean {
  const featureList = features
    .split(',')
    .map((f) => f.trim().toLowerCase())
    .filter(Boolean)
  return featureList.includes('thinking')
}

/**
 * Transform AIHubMix model to ProviderModelEntry
 */
function transformModel(m: AiHubMixModel): ProviderModelEntry {
  const originalId = m.model_id
  const { baseId, variant, parameterSize } = extractVariantAndSize(originalId)

  return {
    originalId,
    normalizedId: normalizeModelId(baseId),
    variant,
    parameterSize,
    pricing: {
      input: m.pricing.input,
      output: m.pricing.output,
      cacheRead: m.pricing.cache_read,
      cacheWrite: m.pricing.cache_write
    },
    contextWindow: m.context_length || undefined,
    maxOutputTokens: m.max_output || undefined,
    hasReasoning: hasReasoningCapability(m.features)
  }
}

/**
 * Parse AIHubMix API response with Zod validation
 */
export function parseAiHubMixResponse(data: unknown): ProviderModelEntry[] {
  const result = AiHubMixResponseSchema.safeParse(data)

  if (!result.success) {
    throw new Error(`Invalid AIHubMix response: ${result.error.message}`)
  }

  return result.data.data.filter((m) => m.model_id && typeof m.model_id === 'string').map(transformModel)
}
