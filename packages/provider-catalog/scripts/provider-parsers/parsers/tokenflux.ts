/**
 * Tokenflux parser
 * Uses verified Zod schema and outputs ProviderModelEntry format
 */

import {
  extractParameterSize,
  extractVariantSuffix,
  normalizeModelId,
  normalizeVersionSeparators,
  stripVariantSuffixes
} from '../../../src/utils/importers/base/base-transformer'
import type { TokenfluxModel } from '../schemas/tokenflux'
import { TokenfluxResponseSchema } from '../schemas/tokenflux'
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
 * Parse price string to number (per million tokens)
 * Tokenflux prices are per-token, multiply by 1,000,000 to get per-million
 */
function parsePrice(priceStr: string | undefined): number | null {
  if (!priceStr || priceStr === '') return null
  const price = parseFloat(priceStr)
  if (isNaN(price)) return null
  // Convert per-token to per-million-tokens
  return price * 1_000_000
}

/**
 * Infer endpoint types from Tokenflux model type
 */
function inferEndpointTypes(modelType: string): string[] | undefined {
  switch (modelType) {
    case 'embedding':
      return ['embeddings']
    case 'reranker':
      return ['rerank']
    case 'image':
      return ['image_generation']
    case 'audio':
      return ['audio_transcription']
    case 'chat':
    case 'language':
      return ['chat_completions']
    default:
      return undefined
  }
}

/**
 * Transform Tokenflux model to ProviderModelEntry
 */
function transformModel(m: TokenfluxModel): ProviderModelEntry {
  const { variant, parameterSize } = extractVariantAndSize(m.id)

  const inputPrice = parsePrice(m.pricing.prompt)
  const outputPrice = parsePrice(m.pricing.completion)
  const cacheReadPrice = parsePrice(m.pricing.input_cache_read)

  return {
    originalId: m.id,
    normalizedId: normalizeModelId(m.id),
    variant,
    parameterSize,
    name: m.name,
    pricing:
      inputPrice !== null || outputPrice !== null
        ? {
            input: inputPrice ?? 0,
            output: outputPrice ?? 0,
            cacheRead: cacheReadPrice ?? undefined,
            currency: 'USD'
          }
        : undefined,
    contextWindow: m.context_length > 0 ? m.context_length : undefined,
    // Model type from Tokenflux
    modelType: m.type,
    endpointTypes: inferEndpointTypes(m.type)
  }
}

/**
 * Parse Tokenflux API response with Zod validation
 */
export function parseTokenfluxResponse(data: unknown): ProviderModelEntry[] {
  const result = TokenfluxResponseSchema.safeParse(data)

  if (!result.success) {
    throw new Error(`Invalid Tokenflux response: ${result.error.message}`)
  }

  return result.data.data
    .filter((m) => m.id && typeof m.id === 'string')
    .filter((m) => m.context_length > 0) // Filter out incomplete models
    .map(transformModel)
}
