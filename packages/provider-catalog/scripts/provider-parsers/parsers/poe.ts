/**
 * Poe parser
 * Uses verified Zod schema and outputs ProviderModelEntry format
 */

import {
  extractParameterSize,
  extractVariantSuffix,
  normalizeModelId,
  normalizeVersionSeparators,
  stripVariantSuffixes
} from '../../../src/utils/importers/base/base-transformer'
import type { PoeModel } from '../schemas/poe'
import { PoeResponseSchema } from '../schemas/poe'
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
 * Infer model type from output modalities
 */
function inferModelType(m: PoeModel): string {
  const output = m.architecture.output_modalities
  if (output.includes('embedding')) return 'embedding'
  if (output.includes('image')) return 'image'
  return 'chat'
}

/**
 * Map Poe modality strings to normalized modality values
 */
function mapInputModalities(modalities: string[]): string[] {
  const mapped: string[] = []
  for (const m of modalities) {
    switch (m.toLowerCase()) {
      case 'text':
        mapped.push('TEXT')
        break
      case 'image':
        mapped.push('IMAGE')
        break
      case 'audio':
        mapped.push('AUDIO')
        break
      case 'video':
        mapped.push('VIDEO')
        break
    }
  }
  return mapped
}

function mapOutputModalities(modalities: string[]): string[] {
  const mapped: string[] = []
  for (const m of modalities) {
    switch (m.toLowerCase()) {
      case 'text':
        mapped.push('TEXT')
        break
      case 'image':
        mapped.push('IMAGE')
        break
      case 'audio':
        mapped.push('AUDIO')
        break
      case 'embedding':
        mapped.push('VECTOR')
        break
    }
  }
  return mapped
}

/**
 * Infer endpoint types from Poe model
 */
function inferEndpointTypes(m: PoeModel): string[] {
  if (m.architecture.output_modalities.includes('embedding')) {
    return ['embeddings']
  }
  if (m.architecture.output_modalities.includes('image')) {
    return ['image_generation']
  }
  return ['chat_completions']
}

/**
 * Transform Poe model to ProviderModelEntry
 */
function transformModel(m: PoeModel): ProviderModelEntry {
  const { variant, parameterSize } = extractVariantAndSize(m.id)

  // Poe pricing is in string format (per token)
  // Convert to per-million-tokens (multiply by 1,000,000)
  let pricing: ProviderModelEntry['pricing']
  if (m.pricing) {
    const promptPrice = parseFloat(m.pricing.prompt) * 1_000_000
    const completionPrice = parseFloat(m.pricing.completion) * 1_000_000
    const cacheReadPrice = m.pricing.input_cache_read ? parseFloat(m.pricing.input_cache_read) * 1_000_000 : undefined

    pricing = {
      input: promptPrice,
      output: completionPrice,
      cacheRead: cacheReadPrice
    }
  }

  return {
    originalId: m.id,
    normalizedId: normalizeModelId(m.id),
    variant,
    parameterSize,
    name: m.metadata.display_name,
    ownedBy: m.owned_by,
    pricing,
    contextWindow: m.context_window?.context_length ?? undefined,
    maxOutputTokens: m.context_window?.max_output_tokens ?? undefined,
    modelType: inferModelType(m),
    hasReasoning: m.reasoning !== null,
    capabilities: {
      chat: m.architecture.output_modalities.includes('text'),
      vision: m.architecture.input_modalities.includes('image'),
      audio: m.architecture.input_modalities.includes('audio'),
      video: m.architecture.input_modalities.includes('video')
    },
    endpointTypes: inferEndpointTypes(m),
    inputModalities: mapInputModalities(m.architecture.input_modalities),
    outputModalities: mapOutputModalities(m.architecture.output_modalities)
  }
}

/**
 * Parse Poe API response with Zod validation
 */
export function parsePoeResponse(data: unknown): ProviderModelEntry[] {
  const result = PoeResponseSchema.safeParse(data)

  if (!result.success) {
    throw new Error(`Invalid Poe response: ${result.error.message}`)
  }

  return result.data.data.filter((m) => m.id && typeof m.id === 'string').map(transformModel)
}
