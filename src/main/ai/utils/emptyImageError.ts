import { NoImageGeneratedError } from 'ai'

import { t } from '@main/i18n'

/** Keep provider responses out of the user-facing empty-image error. */
export function createEmptyImageError(providerId: string, modelId: string): Error {
  return Object.assign(new Error(t('ai.image.error.no_images', { model: modelId })), {
    providerId,
    modelId,
    code: EMPTY_IMAGE_ERROR_CODE
  })
}

/** Discriminator for a completed request that produced no usable image (it may still have been billed). */
export const EMPTY_IMAGE_ERROR_CODE = 'IMAGE_NO_OUTPUT'

export function isEmptyImageError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === EMPTY_IMAGE_ERROR_CODE
}

/** Only classify SDK-branded errors, including ai-core's cause wrapper. */
export function isEmptyImageGenerationError(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    if (NoImageGeneratedError.isInstance(current)) return true
    current = 'cause' in current ? current.cause : undefined
  }
  return false
}
