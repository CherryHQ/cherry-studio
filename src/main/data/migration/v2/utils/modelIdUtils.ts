/**
 * Shared utility functions for migration mappings
 */

/** Branded type for composite model IDs in `provider::modelId` format */
export type CompositeModelId = string & { readonly __brand: 'CompositeModelId' }

/**
 * Build a composite model ID in `providerId::modelId` format.
 * Returns null if either part is missing or not a string.
 *
 * Accepts any object with `provider` and `id` fields (typed or untyped).
 */
export function buildCompositeModelId(model: { provider?: unknown; id?: unknown }): CompositeModelId | null {
  const providerId = typeof model.provider === 'string' ? model.provider.trim() : ''
  const modelId = typeof model.id === 'string' ? model.id.trim() : ''
  if (!providerId || !modelId) return null
  return `${providerId}::${modelId}` as CompositeModelId
}
