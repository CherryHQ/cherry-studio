/**
 * Hyperbolic parser
 * Uses verified Zod schema and outputs ProviderModelEntry format
 */

import {
  extractParameterSize,
  extractVariantSuffix,
  normalizeModelId,
  normalizeVersionSeparators,
  stripVariantSuffixes
} from '../../../src/utils/importers/base/base-transformer'
import type { HyperbolicModel } from '../schemas/hyperbolic'
import { HyperbolicResponseSchema } from '../schemas/hyperbolic'
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
 * Infer input modalities from Hyperbolic model
 */
function inferInputModalities(m: HyperbolicModel): string[] | undefined {
  if (!m.supports_chat) return undefined
  const modalities: string[] = ['TEXT']
  if (m.supports_image_input) {
    modalities.push('VISION')
  }
  return modalities
}

/**
 * Transform Hyperbolic model to ProviderModelEntry
 */
function transformModel(m: HyperbolicModel): ProviderModelEntry {
  const { variant, parameterSize } = extractVariantAndSize(m.id)

  // Hyperbolic pricing is per million tokens (e.g., 0.4 = $0.4 per million)
  // Some models (image gen, TTS) have null pricing
  const pricing =
    m.input_price !== null && m.output_price !== null ? { input: m.input_price, output: m.output_price } : undefined

  return {
    originalId: m.id,
    normalizedId: normalizeModelId(m.id),
    variant,
    parameterSize,
    ownedBy: m.owned_by,
    pricing,
    contextWindow: m.context_length !== null ? m.context_length : undefined,
    capabilities: {
      chat: m.supports_chat,
      vision: m.supports_image_input,
      functionCalling: m.supports_tools
    },
    endpointTypes: m.supports_chat ? ['chat_completions'] : undefined,
    inputModalities: inferInputModalities(m)
  }
}

/**
 * Parse Hyperbolic API response with Zod validation
 */
export function parseHyperbolicResponse(data: unknown): ProviderModelEntry[] {
  const result = HyperbolicResponseSchema.safeParse(data)

  if (!result.success) {
    throw new Error(`Invalid Hyperbolic response: ${result.error.message}`)
  }

  return result.data.data.filter((m) => m.id && typeof m.id === 'string').map(transformModel)
}
