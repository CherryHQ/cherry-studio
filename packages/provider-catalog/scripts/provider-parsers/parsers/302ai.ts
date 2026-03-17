/**
 * 302ai parser
 * Uses verified Zod schema and outputs ProviderModelEntry format
 */

import {
  extractParameterSize,
  extractVariantSuffix,
  normalizeModelId,
  normalizeVersionSeparators,
  stripVariantSuffixes
} from '../../../src/utils/importers/base/base-transformer'
import type { AI302Model } from '../schemas/302ai'
import { AI302ResponseSchema } from '../schemas/302ai'
import type { ProviderModelEntry } from '../types'

/**
 * Extract variant suffix and parameter size from model ID
 */
function extractVariantAndSize(id: string): { variant: string | null; parameterSize: string | null } {
  const variant = extractVariantSuffix(id) || null
  const baseId = variant ? stripVariantSuffixes(id) : id
  const normalizedBaseId = normalizeVersionSeparators(baseId.toLowerCase())
  const parameterSize = extractParameterSize(normalizedBaseId) || null
  return { variant, parameterSize }
}

/**
 * Parse price string like "$1.500 / M tokens" to number (per million tokens)
 */
function parsePrice(priceStr: string | undefined): number | null {
  if (!priceStr || priceStr === '') return null

  // Match pattern like "$1.500 / M tokens" or "¥1.500 / M tokens"
  const match = priceStr.match(/[$¥]?([\d.]+)\s*\/?\s*M?\s*tokens?/i)
  if (!match) return null

  const price = parseFloat(match[1])
  if (isNaN(price)) return null

  return price
}

/**
 * Transform 302ai model to ProviderModelEntry
 */
function transformModel(m: AI302Model): ProviderModelEntry {
  const { variant, parameterSize } = extractVariantAndSize(m.id)

  const inputPrice = parsePrice(m.price?.input_token)
  const outputPrice = parsePrice(m.price?.output_token)

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
    contextWindow: m.context_length && m.context_length > 0 ? m.context_length : undefined,
    maxOutputTokens: m.max_completion_tokens && m.max_completion_tokens > 0 ? m.max_completion_tokens : undefined,
    hasReasoning: m.reasoning,
    // Map capabilities
    capabilities: {
      function_call: m.supported_tools ?? false,
      reasoning: m.reasoning ?? false
    }
  }
}

/**
 * Parse 302ai API response with Zod validation
 */
export function parse302aiResponse(data: unknown): ProviderModelEntry[] {
  const result = AI302ResponseSchema.safeParse(data)

  if (!result.success) {
    throw new Error(`Invalid 302ai response: ${result.error.message}`)
  }

  return result.data.data.filter((m) => m.id && typeof m.id === 'string').map(transformModel)
}
