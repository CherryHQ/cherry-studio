/**
 * Google (Gemini) parser
 * Uses verified Zod schema and outputs ProviderModelEntry format
 *
 * Note: Google uses different field names:
 * - models[] instead of data[]
 * - name instead of id (e.g., "models/gemini-2.5-flash")
 */

import {
  extractParameterSize,
  extractVariantSuffix,
  normalizeModelId,
  normalizeVersionSeparators,
  stripVariantSuffixes
} from '../../../src/utils/importers/base/base-transformer'
import type { GoogleModel } from '../schemas/google'
import { GoogleResponseSchema } from '../schemas/google'
import type { ProviderModelEntry } from '../types'

/**
 * Extract model ID from Google's name field
 * "models/gemini-2.5-flash" -> "gemini-2.5-flash"
 */
function extractModelId(name: string): string {
  return name.replace(/^models\//, '')
}

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
 * Map Google supportedGenerationMethods to EndpointType strings
 */
function extractEndpointTypes(methods: string[]): string[] | undefined {
  const endpoints: string[] = []
  if (methods.includes('generateContent')) {
    endpoints.push('generate_content')
  }
  if (methods.includes('embedContent')) {
    endpoints.push('embeddings')
  }
  return endpoints.length > 0 ? endpoints : undefined
}

/**
 * Transform Google model to ProviderModelEntry
 */
function transformModel(m: GoogleModel): ProviderModelEntry {
  const modelId = extractModelId(m.name)
  const { variant, parameterSize } = extractVariantAndSize(modelId)

  return {
    originalId: modelId,
    normalizedId: normalizeModelId(modelId),
    variant,
    parameterSize,
    name: m.displayName,
    ownedBy: 'google',
    // Google API doesn't provide pricing
    contextWindow: m.inputTokenLimit,
    maxOutputTokens: m.outputTokenLimit,
    // Google has explicit thinking flag
    hasReasoning: m.thinking === true,
    endpointTypes: extractEndpointTypes(m.supportedGenerationMethods)
  }
}

/**
 * Parse Google API response with Zod validation
 */
export function parseGoogleResponse(data: unknown): ProviderModelEntry[] {
  const result = GoogleResponseSchema.safeParse(data)

  if (!result.success) {
    throw new Error(`Invalid Google response: ${result.error.message}`)
  }

  return result.data.models.filter((m) => m.name && typeof m.name === 'string').map(transformModel)
}
