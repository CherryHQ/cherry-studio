/**
 * Mistral parser
 * Handles the Mistral /v1/models API response
 */

import {
  extractParameterSize,
  extractVariantSuffix,
  normalizeModelId,
  normalizeVersionSeparators,
  stripVariantSuffixes
} from '../../../src/utils/importers/base/base-transformer'
import type { MistralModel } from '../schemas/mistral'
import { MistralResponseSchema } from '../schemas/mistral'
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
 * Infer endpoint types from Mistral capabilities
 */
function inferEndpointTypes(caps: MistralModel['capabilities'], type: string): string[] | undefined {
  const endpoints: string[] = []
  if (caps.completion_chat) {
    endpoints.push('chat_completions')
  }
  if (caps.completion_fim) {
    endpoints.push('text_completions')
  }
  // Mistral 'type' field can indicate embedding models
  if (type === 'embedding') {
    endpoints.push('embeddings')
  }
  return endpoints.length > 0 ? endpoints : undefined
}

/**
 * Infer input modalities from Mistral capabilities
 */
function inferInputModalities(caps: MistralModel['capabilities']): string[] | undefined {
  const modalities: string[] = ['TEXT']
  if (caps.vision || caps.ocr) {
    modalities.push('VISION')
  }
  if (caps.audio || caps.audio_transcription) {
    modalities.push('AUDIO')
  }
  return modalities
}

/**
 * Transform Mistral model to ProviderModelEntry
 */
function transformModel(m: MistralModel): ProviderModelEntry {
  const originalId = m.id
  const { baseId, variant, parameterSize } = extractVariantAndSize(originalId)

  return {
    originalId,
    normalizedId: normalizeModelId(baseId),
    variant,
    parameterSize,
    name: m.name || m.id,
    ownedBy: m.owned_by,
    contextWindow: m.max_context_length,
    // Mistral doesn't provide pricing via API - would need to be added manually
    // Mistral doesn't expose reasoning capability via API yet
    hasReasoning: false,
    endpointTypes: inferEndpointTypes(m.capabilities, m.type),
    inputModalities: inferInputModalities(m.capabilities)
  }
}

/**
 * Parse Mistral API response with Zod validation
 */
export function parseMistralResponse(data: unknown): ProviderModelEntry[] {
  const result = MistralResponseSchema.safeParse(data)

  if (!result.success) {
    throw new Error(`Invalid Mistral response: ${result.error.message}`)
  }

  return result.data.data
    .filter((m) => m.id && typeof m.id === 'string')
    .filter((m) => !m.deprecation) // Skip deprecated models
    .map(transformModel)
}
