/**
 * Vercel AI Gateway parser
 * Uses verified Zod schema and outputs ProviderModelEntry format
 */

import {
  extractParameterSize,
  extractVariantSuffix,
  normalizeModelId,
  normalizeVersionSeparators,
  stripVariantSuffixes
} from '../../../src/utils/importers/base/base-transformer'
import type { VercelModel } from '../schemas/vercel-gateway'
import { VercelResponseSchema } from '../schemas/vercel-gateway'
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
 * Vercel prices are per-token, multiply by 1,000,000 to get per-million
 */
function parsePrice(priceStr: string | undefined): number | null {
  if (!priceStr || priceStr === '') return null
  const price = parseFloat(priceStr)
  if (isNaN(price)) return null
  // Convert per-token to per-million-tokens
  return price * 1_000_000
}

/**
 * Check if model has reasoning capability based on tags
 */
function hasReasoning(tags?: string[]): boolean {
  if (!tags) return false
  return tags.some((tag) => tag.toLowerCase().includes('reasoning') || tag.toLowerCase().includes('thinking'))
}

/**
 * Infer endpoint types from Vercel model type
 */
function inferEndpointTypes(modelType: string | undefined): string[] | undefined {
  switch (modelType) {
    case 'embedding':
      return ['embeddings']
    case 'image':
      return ['image_generation']
    case 'chat':
    case 'language':
      return ['chat_completions']
    default:
      return undefined
  }
}

/**
 * Transform Vercel model to ProviderModelEntry
 */
function transformModel(m: VercelModel): ProviderModelEntry {
  const { variant, parameterSize } = extractVariantAndSize(m.id)

  const inputPrice = parsePrice(m.pricing?.input)
  const outputPrice = parsePrice(m.pricing?.output)

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
            currency: 'USD'
          }
        : undefined,
    hasReasoning: hasReasoning(m.tags),
    modelType: m.modelType,
    capabilities: {
      reasoning: hasReasoning(m.tags),
      tool_use: m.tags?.includes('tool-use') ?? false
    },
    endpointTypes: inferEndpointTypes(m.modelType)
  }
}

/**
 * Parse Vercel AI Gateway API response with Zod validation
 */
export function parseVercelGatewayResponse(data: unknown): ProviderModelEntry[] {
  const result = VercelResponseSchema.safeParse(data)

  if (!result.success) {
    throw new Error(`Invalid Vercel AI Gateway response: ${result.error.message}`)
  }

  return result.data.models.filter((m) => m.id && typeof m.id === 'string').map(transformModel)
}
