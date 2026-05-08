/**
 * Legacy Model ID Conversion Utility
 *
 * Converts old `{ id, provider }` model references to the v2 UniqueModelId
 * format (`providerId::modelId`). Used by multiple migrators to ensure
 * consistent conversion with proper validation, whitespace trimming,
 * and pre-composed ID passthrough.
 */

import {
  createUniqueModelId,
  isUniqueModelId,
  UNIQUE_MODEL_ID_SEPARATOR,
  type UniqueModelId
} from '@shared/data/types/model'

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
 * @returns UniqueModelId when conversion succeeds, otherwise null
 */
export function legacyModelToUniqueId(model: LegacyModelRef | null | undefined): UniqueModelId | null
export function legacyModelToUniqueId(
  model: LegacyModelRef | null | undefined,
  fallback: string | null | undefined
): UniqueModelId | null
export function legacyModelToUniqueId(
  model: LegacyModelRef | null | undefined,
  fallback?: string | null
): UniqueModelId | null {
  if (model != null && typeof model === 'object') {
    const providerId = typeof model.provider === 'string' ? model.provider.trim() : ''
    const modelId = typeof model.id === 'string' ? model.id.trim() : ''

    if (providerId && modelId) {
      // If the modelId is already a composite ID, return it directly to avoid double-prefixing.
      if (modelId.includes(UNIQUE_MODEL_ID_SEPARATOR)) {
        return modelId as UniqueModelId
      }
      if (providerId.includes(UNIQUE_MODEL_ID_SEPARATOR)) {
        return null
      }
      return createUniqueModelId(providerId, modelId)
    }
  }

  if (typeof fallback === 'string') {
    const trimmedFallback = fallback.trim()
    if (trimmedFallback && isUniqueModelId(trimmedFallback)) {
      return trimmedFallback
    }
  }

  return null
}

export function legacyModelJsonToUniqueId(value: unknown): UniqueModelId | null {
  if (typeof value !== 'string') {
    return null
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return parsed != null && typeof parsed === 'object' ? legacyModelToUniqueId(parsed as LegacyModelRef) : null
  } catch {
    return null
  }
}

export type ModelReferenceResolution =
  | { kind: 'resolved'; modelId: UniqueModelId }
  | { kind: 'missing' }
  | { kind: 'dangling'; modelId: UniqueModelId }

/**
 * Validate a candidate UniqueModelId against the migrated user_model set.
 *
 * If `validModelIds` is omitted/null, the candidate is treated as resolved.
 * This keeps the helper pure while allowing light-weight unit tests that do not
 * wire a database-backed validation set.
 */
export function resolveModelReference(
  modelId: string | null | undefined,
  validModelIds?: ReadonlySet<string> | null
): ModelReferenceResolution {
  if (!modelId) {
    return { kind: 'missing' }
  }

  if (validModelIds && !validModelIds.has(modelId)) {
    return { kind: 'dangling', modelId: modelId as UniqueModelId }
  }

  return { kind: 'resolved', modelId: modelId as UniqueModelId }
}

/**
 * Resolve a legacy model reference all the way to a validated migrated model ID.
 */
export function resolveLegacyModelReference(
  model: LegacyModelRef | null | undefined,
  fallback?: string | null,
  validModelIds?: ReadonlySet<string> | null
): ModelReferenceResolution {
  return resolveModelReference(legacyModelToUniqueId(model, fallback), validModelIds)
}
