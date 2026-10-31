import { NoImageGeneratedError } from 'ai'

import { t } from '@main/i18n'

/** Keep provider responses out of the user-facing empty-image error. */
export function createEmptyImageError(providerId: string, modelId: string): Error {
  return Object.assign(new Error(t('ai.image.error.no_images', { model: modelId })), { providerId, modelId })
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
