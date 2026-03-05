/**
 * GitHub Models parser
 * Uses verified Zod schema and outputs ProviderModelEntry format
 */

import {
  extractParameterSize,
  extractVariantSuffix,
  normalizeModelId,
  normalizeVersionSeparators,
  stripVariantSuffixes
} from '../../../src/utils/importers/base/base-transformer'
import type { GitHubModel } from '../schemas/github'
import { GitHubResponseSchema } from '../schemas/github'
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
 * Infer model type from output modalities
 */
function inferModelType(m: GitHubModel): string {
  const output = m.supported_output_modalities
  if (output.includes('embeddings')) return 'embedding'
  return 'chat'
}

/**
 * Map GitHub modality strings to normalized modality values
 */
function mapInputModalities(modalities: string[]): string[] {
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
    }
  }
  return mapped
}

/**
 * Map GitHub output modality strings to normalized modality values
 */
function mapOutputModalities(modalities: string[]): string[] {
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
      case 'embeddings':
        mapped.push('VECTOR')
        break
    }
  }
  return mapped
}

/**
 * Infer endpoint types from GitHub model
 */
function inferEndpointTypes(m: GitHubModel): string[] | undefined {
  if (m.supported_output_modalities.includes('embeddings')) {
    return ['embeddings']
  }
  return ['chat_completions']
}

/**
 * Transform GitHub model to ProviderModelEntry
 */
function transformModel(m: GitHubModel): ProviderModelEntry {
  const { variant, parameterSize } = extractVariantAndSize(m.id)

  // Check for reasoning capability
  const hasReasoning = m.capabilities.includes('reasoning') || m.tags.includes('reasoning')

  return {
    originalId: m.id,
    normalizedId: normalizeModelId(m.id),
    variant,
    parameterSize,
    name: m.name,
    ownedBy: m.publisher,
    // GitHub doesn't provide pricing (free tier)
    contextWindow: m.limits.max_input_tokens,
    maxOutputTokens: m.limits.max_output_tokens ?? undefined,
    modelType: inferModelType(m),
    hasReasoning,
    capabilities: {
      chat: m.supported_output_modalities.includes('text'),
      vision: m.supported_input_modalities.includes('image'),
      audio: m.supported_input_modalities.includes('audio'),
      functionCalling: m.capabilities.includes('tool-calling'),
      streaming: m.capabilities.includes('streaming')
    },
    endpointTypes: inferEndpointTypes(m),
    inputModalities: mapInputModalities(m.supported_input_modalities),
    outputModalities: mapOutputModalities(m.supported_output_modalities)
  }
}

/**
 * Parse GitHub Models API response with Zod validation
 */
export function parseGitHubResponse(data: unknown): ProviderModelEntry[] {
  const result = GitHubResponseSchema.safeParse(data)

  if (!result.success) {
    throw new Error(`Invalid GitHub response: ${result.error.message}`)
  }

  return result.data.filter((m) => m.id && typeof m.id === 'string').map(transformModel)
}
