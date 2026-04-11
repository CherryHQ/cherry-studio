/**
 * Knowledge model configuration helpers.
 *
 * Temporary knowledge-domain implementation.
 * TODO: consolidate this parser into shared model utils after v2 settles.
 */

export interface CompositeModelRef {
  providerId: string
  modelId: string
}

const COMPOSITE_MODEL_SEPARATOR = '::'

/**
 * Parse a composite model id stored in DB as `providerId::modelId`.
 *
 * Current scope is knowledge-domain only.
 * Future model-id parsing should be unified in shared model utils.
 */
export function parseCompositeModelId(value: string): CompositeModelRef {
  const separatorIndex = value.indexOf(COMPOSITE_MODEL_SEPARATOR)
  const lastSeparatorIndex = value.lastIndexOf(COMPOSITE_MODEL_SEPARATOR)

  if (
    !value ||
    separatorIndex <= 0 ||
    separatorIndex !== lastSeparatorIndex ||
    separatorIndex + COMPOSITE_MODEL_SEPARATOR.length >= value.length
  ) {
    throw new Error(`Invalid composite model id "${value}". Expected format: "providerId::modelId".`)
  }

  const providerId = value.slice(0, separatorIndex).trim()
  const modelId = value.slice(separatorIndex + COMPOSITE_MODEL_SEPARATOR.length).trim()

  // Strict format guard: no leading/trailing spaces and no whitespace around separator.
  if (!providerId || !modelId || `${providerId}${COMPOSITE_MODEL_SEPARATOR}${modelId}` !== value) {
    throw new Error(`Invalid composite model id "${value}". Expected format: "providerId::modelId".`)
  }

  return { providerId, modelId }
}
