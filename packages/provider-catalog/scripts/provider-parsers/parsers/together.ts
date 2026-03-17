/**
 * Together parser
 * Handles the Together /v1/models API response (returns array directly)
 */

import {
  extractParameterSize,
  extractVariantSuffix,
  normalizeModelId,
  normalizeVersionSeparators,
  stripVariantSuffixes
} from '../../../src/utils/importers/base/base-transformer'
import type { TogetherModel } from '../schemas/together'
import { TogetherResponseSchema } from '../schemas/together'
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
 * Infer endpoint types from Together model type
 */
function inferEndpointTypes(type: string): string[] | undefined {
  switch (type) {
    case 'chat':
    case 'language':
      return ['chat_completions']
    case 'embedding':
      return ['embeddings']
    case 'rerank':
      return ['rerank']
    case 'image':
      return ['image_generation']
    case 'moderation':
    case 'code':
      return ['chat_completions']
    default:
      return undefined
  }
}

/**
 * Transform Together model to ProviderModelEntry
 */
function transformModel(m: TogetherModel): ProviderModelEntry {
  const originalId = m.id
  const { baseId, variant, parameterSize } = extractVariantAndSize(originalId)

  // Together provides pricing in the API (per token)
  const inputPrice = m.pricing?.input ?? 0
  const outputPrice = m.pricing?.output ?? 0

  return {
    originalId,
    normalizedId: normalizeModelId(baseId),
    variant,
    parameterSize,
    name: m.display_name,
    ownedBy: m.organization,
    contextWindow: m.context_length,
    pricing:
      inputPrice > 0 || outputPrice > 0
        ? {
            input: inputPrice * 1_000_000,
            output: outputPrice * 1_000_000
          }
        : undefined,
    endpointTypes: inferEndpointTypes(m.type)
  }
}

/**
 * Parse Together API response with Zod validation
 * Note: Together returns array directly, not { data: [...] }
 */
export function parseTogetherResponse(data: unknown): ProviderModelEntry[] {
  const result = TogetherResponseSchema.safeParse(data)

  if (!result.success) {
    throw new Error(`Invalid Together response: ${result.error.message}`)
  }

  return result.data.filter((m) => m.id && typeof m.id === 'string').map(transformModel)
}
