/**
 * Fireworks parser
 * Handles the Fireworks /inference/v1/models API response
 */

import {
  extractParameterSize,
  extractVariantSuffix,
  normalizeModelId,
  normalizeVersionSeparators,
  stripVariantSuffixes
} from '../../../src/utils/importers/base/base-transformer'
import type { FireworksModel } from '../schemas/fireworks'
import { FireworksResponseSchema } from '../schemas/fireworks'
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
 * Infer endpoint types from Fireworks model
 */
function inferEndpointTypes(m: FireworksModel): string[] | undefined {
  const endpoints: string[] = []
  if (m.supports_chat) {
    endpoints.push('chat_completions')
  }
  // Fireworks 'kind' field can indicate embedding models
  if (m.kind === 'embedding') {
    endpoints.push('embeddings')
  }
  return endpoints.length > 0 ? endpoints : undefined
}

/**
 * Infer input modalities from Fireworks model capabilities
 */
function inferInputModalities(m: FireworksModel): string[] | undefined {
  const modalities: string[] = ['TEXT']
  if (m.supports_image_input) {
    modalities.push('IMAGE')
  }
  return modalities
}

/**
 * Transform Fireworks model to ProviderModelEntry
 */
function transformModel(m: FireworksModel): ProviderModelEntry {
  const originalId = m.id
  const { baseId, variant, parameterSize } = extractVariantAndSize(originalId)

  return {
    originalId,
    normalizedId: normalizeModelId(baseId),
    variant,
    parameterSize,
    ownedBy: m.owned_by,
    contextWindow: m.context_length,
    // Fireworks doesn't provide pricing via API
    endpointTypes: inferEndpointTypes(m),
    inputModalities: inferInputModalities(m)
  }
}

/**
 * Parse Fireworks API response with Zod validation
 */
export function parseFireworksResponse(data: unknown): ProviderModelEntry[] {
  const result = FireworksResponseSchema.safeParse(data)

  if (!result.success) {
    throw new Error(`Invalid Fireworks response: ${result.error.message}`)
  }

  return result.data.data.filter((m) => m.id && typeof m.id === 'string').map(transformModel)
}
