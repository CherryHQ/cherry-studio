/**
 * PPIO parser
 * Uses verified Zod schema and outputs ProviderModelEntry format
 */

import {
  extractParameterSize,
  extractVariantSuffix,
  normalizeModelId,
  normalizeVersionSeparators,
  stripVariantSuffixes
} from '../../../src/utils/importers/base/base-transformer'
import type { PPIOModel } from '../schemas/ppio'
import { PPIOResponseSchema } from '../schemas/ppio'
import type { ProviderModelEntry } from '../types'

/**
 * Extract variant suffix and parameter size from model ID
 */
function extractVariantAndSize(id: string): { variant: string | null; parameterSize: string | null } {
  const parts = id.split('/')
  const modelName = parts[parts.length - 1]
  const variant = extractVariantSuffix(modelName) || null
  const baseId = variant ? stripVariantSuffixes(modelName) : modelName
  const normalizedBaseId = normalizeVersionSeparators(baseId.toLowerCase())
  const parameterSize = extractParameterSize(normalizedBaseId) || null
  return { variant, parameterSize }
}

/**
 * Infer endpoint types from PPIO model type
 */
function inferEndpointTypes(modelType: string): string[] | undefined {
  switch (modelType) {
    case 'embedding':
      return ['embeddings']
    case 'reranker':
      return ['rerank']
    case 'chat':
    case 'llm':
      return ['chat_completions']
    default:
      return undefined
  }
}

/**
 * Transform PPIO model to ProviderModelEntry
 */
function transformModel(m: PPIOModel): ProviderModelEntry {
  const { variant, parameterSize } = extractVariantAndSize(m.id)

  return {
    originalId: m.id,
    normalizedId: normalizeModelId(m.id),
    variant,
    parameterSize,
    name: m.display_name || m.title,
    ownedBy: m.owned_by,
    // PPIO pricing is in CNY × 10000 per million tokens
    // Divide by 10000 to get CNY per million tokens
    pricing: {
      input: m.input_token_price_per_m / 10000,
      output: m.output_token_price_per_m / 10000,
      currency: 'CNY'
    },
    contextWindow: m.context_size,
    maxOutputTokens: m.max_output_tokens,
    // Model type from PPIO
    modelType: m.model_type,
    endpointTypes: inferEndpointTypes(m.model_type)
  }
}

/**
 * Parse PPIO API response with Zod validation
 */
export function parsePPIOResponse(data: unknown): ProviderModelEntry[] {
  const result = PPIOResponseSchema.safeParse(data)

  if (!result.success) {
    throw new Error(`Invalid PPIO response: ${result.error.message}`)
  }

  return result.data.data
    .filter((m) => m.id && typeof m.id === 'string')
    .filter((m) => m.status === 1) // Only active models
    .map(transformModel)
}
