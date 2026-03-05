/**
 * Jina parser
 * Uses verified Zod schema and outputs ProviderModelEntry format
 */

import {
  extractParameterSize,
  extractVariantSuffix,
  normalizeModelId,
  normalizeVersionSeparators,
  stripVariantSuffixes
} from '../../../src/utils/importers/base/base-transformer'
import type { JinaModel } from '../schemas/jina'
import { JinaResponseSchema } from '../schemas/jina'
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
 * Infer model type from modalities
 */
function inferModelType(m: JinaModel): string {
  const output = m.output_modalities
  if (output.includes('embedding')) return 'embedding'
  if (m.id.includes('reranker')) return 'reranker'
  return 'chat'
}

/**
 * Infer endpoint types from Jina model type
 */
function inferEndpointTypes(modelType: string): string[] {
  switch (modelType) {
    case 'embedding':
      return ['embeddings']
    case 'reranker':
      return ['rerank']
    default:
      return ['chat_completions']
  }
}

/**
 * Transform Jina model to ProviderModelEntry
 */
function transformModel(m: JinaModel): ProviderModelEntry {
  const { variant, parameterSize } = extractVariantAndSize(m.id)

  // Jina pricing is in string format like "0.00000005"
  // Convert to per-million-tokens (multiply by 1,000,000)
  const promptPrice = parseFloat(m.pricing.prompt) * 1_000_000
  const completionPrice = parseFloat(m.pricing.completion) * 1_000_000

  const modelType = inferModelType(m)

  return {
    originalId: m.id,
    normalizedId: normalizeModelId(m.id),
    variant,
    parameterSize,
    name: m.name,
    // Jina pricing is per token, convert to per million
    pricing: {
      input: promptPrice,
      output: completionPrice
    },
    contextWindow: m.context_length,
    maxOutputTokens: m.max_output_length || undefined,
    modelType,
    endpointTypes: inferEndpointTypes(modelType)
  }
}

/**
 * Parse Jina API response with Zod validation
 */
export function parseJinaResponse(data: unknown): ProviderModelEntry[] {
  const result = JinaResponseSchema.safeParse(data)

  if (!result.success) {
    throw new Error(`Invalid Jina response: ${result.error.message}`)
  }

  return result.data.data.filter((m) => m.id && typeof m.id === 'string').map(transformModel)
}
