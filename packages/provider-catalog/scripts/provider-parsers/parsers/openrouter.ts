/**
 * OpenRouter parser adapter
 * Uses the existing OpenRouterTransformer but outputs ProviderModelEntry format
 */

import {
  extractParameterSize,
  extractVariantSuffix,
  normalizeModelId,
  normalizeVersionSeparators,
  stripVariantSuffixes
} from '../../../src/utils/importers/base/base-transformer'
import type { OpenRouterModel } from '../../../src/utils/importers/openrouter/types'
import { OpenRouterResponseSchema } from '../../../src/utils/importers/openrouter/types'
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
 * Map OpenRouter modality strings to normalized modality values
 */
function mapModalities(modalities: string[] | undefined): string[] | undefined {
  if (!modalities || modalities.length === 0) return undefined
  const mapped: string[] = []
  for (const m of modalities) {
    switch (m.toLowerCase()) {
      case 'text':
        mapped.push('TEXT')
        break
      case 'image':
        mapped.push('VISION')
        break
      case 'audio':
        mapped.push('AUDIO')
        break
      case 'video':
        mapped.push('VIDEO')
        break
      case 'embedding':
        mapped.push('VECTOR')
        break
    }
  }
  return mapped.length > 0 ? mapped : undefined
}

/**
 * Transform OpenRouter model to ProviderModelEntry
 */
function transformModel(m: OpenRouterModel): ProviderModelEntry {
  const originalId = m.id
  const { baseId, variant, parameterSize } = extractVariantAndSize(originalId)

  // Check for reasoning capability
  const hasReasoning =
    m.supported_parameters?.includes('reasoning') || m.supported_parameters?.includes('include_reasoning')

  // Parse pricing (OpenRouter uses per-token strings)
  const promptPrice = parseFloat(m.pricing?.prompt || '0')
  const completionPrice = parseFloat(m.pricing?.completion || '0')
  const cacheReadPrice = m.pricing?.input_cache_read ? parseFloat(m.pricing.input_cache_read) : undefined

  return {
    originalId,
    normalizedId: normalizeModelId(baseId),
    variant,
    parameterSize,
    name: m.name,
    pricing:
      promptPrice >= 0 && completionPrice >= 0
        ? {
            input: promptPrice * 1_000_000,
            output: completionPrice * 1_000_000,
            cacheRead: cacheReadPrice ? cacheReadPrice * 1_000_000 : undefined
          }
        : undefined,
    contextWindow: m.context_length,
    maxOutputTokens: m.top_provider?.max_completion_tokens ?? undefined,
    hasReasoning,
    // OpenRouter is an aggregator — all models use CHAT_COMPLETIONS
    endpointTypes: ['chat_completions'],
    inputModalities: mapModalities(m.architecture?.input_modalities),
    outputModalities: mapModalities(m.architecture?.output_modalities)
  }
}

/**
 * Parse OpenRouter API response with Zod validation
 */
export function parseOpenRouterResponse(data: unknown): ProviderModelEntry[] {
  const result = OpenRouterResponseSchema.safeParse(data)

  if (!result.success) {
    throw new Error(`Invalid OpenRouter response: ${result.error.message}`)
  }

  return result.data.data.filter((m) => m.id && typeof m.id === 'string').map(transformModel)
}
