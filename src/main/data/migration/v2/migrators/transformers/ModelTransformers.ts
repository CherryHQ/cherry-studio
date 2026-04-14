/**
 * Legacy Model ID Conversion Utility
 *
 * Converts old `{ id, provider }` model references to the v2 UniqueModelId
 * format (`providerId::modelId`). Used by multiple migrators to ensure
 * consistent conversion with proper validation, whitespace trimming,
 * and pre-composed ID passthrough.
 */

import { createUniqueModelId, UNIQUE_MODEL_ID_SEPARATOR, type UniqueModelId } from '@shared/data/types/model'

/**
 * Shape of a legacy model object. All fields optional to handle
 * null, undefined, incomplete, or non-object inputs gracefully.
 *
 * Intentionally uses `Pick`-style shape (no index signature) so that
 * concrete legacy model interfaces (e.g. `OldModel`) are assignable
 * without requiring an explicit index signature.
 */
export interface LegacyModelRef {
  id?: string
  provider?: string
}

/**
 * Convert a legacy model reference to a UniqueModelId.
 *
 * Handles: null/undefined input, missing fields, empty strings,
 * whitespace-only strings, non-string fields, and pre-composed IDs
 * (where model.id already contains "::").
 *
 * @param model - Legacy model object (may be null/undefined/incomplete)
 * @param fallback - Optional raw string fallback (e.g. oldMessage.modelId)
 * @returns UniqueModelId when conversion succeeds, raw fallback string, or null
 */
export function legacyModelToUniqueId(model: LegacyModelRef | null | undefined): UniqueModelId | null
export function legacyModelToUniqueId(
  model: LegacyModelRef | null | undefined,
  fallback: string | null | undefined
): string | null
export function legacyModelToUniqueId(
  model: LegacyModelRef | null | undefined,
  fallback?: string | null
): string | null {
  if (model != null && typeof model === 'object') {
    const providerId = typeof model.provider === 'string' ? model.provider.trim() : ''
    const modelId = typeof model.id === 'string' ? model.id.trim() : ''

    if (providerId && modelId) {
      // If the modelId is already a composite ID, return it directly to avoid double-prefixing.
      if (modelId.includes(UNIQUE_MODEL_ID_SEPARATOR)) {
        return modelId as UniqueModelId
      }
      return createUniqueModelId(providerId, modelId)
    }
  }

  // Apply optional fallback (for cases like ChatMappings where a raw modelId exists)
  if (typeof fallback === 'string' && fallback.length > 0) {
    return fallback
  }

  return null
}
