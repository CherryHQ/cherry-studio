/** Renderer i18n key (carried over IPC by serializeError) for a completed request that returned no usable image. */
export const NO_USABLE_IMAGE_I18N_KEY = 'image_no_usable_output'

/**
 * The upstream request completed but yielded no usable image, so the provider may already have billed it.
 * The discriminator survives IPC (`i18nKey`, `detailI18nValues`); the English message is for logs.
 */
export function createNoUsableImageError(modelId: string): Error {
  return Object.assign(
    new Error(
      `Image generation for '${modelId}' completed upstream but returned no usable images. The provider may still have billed this request; no further request was sent after this result.`
    ),
    { i18nKey: NO_USABLE_IMAGE_I18N_KEY, detailI18nValues: { model: modelId } }
  )
}

export function isNoUsableImageError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { i18nKey?: unknown }).i18nKey === NO_USABLE_IMAGE_I18N_KEY
  )
}
