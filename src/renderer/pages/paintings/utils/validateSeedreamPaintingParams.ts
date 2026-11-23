import i18n from '@renderer/i18n/resolver'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'
import { isSeedream5xTargetModel, validateSeedreamImageParams } from '@shared/ai/seedreamImageContract'

import type { PaintingData } from '../model/types/paintingData'

export function validateSeedreamPaintingParams(painting: PaintingData): void {
  if (!isSeedream5xTargetModel(painting.model ?? '')) return
  const issue = validateSeedreamImageParams(painting.params ?? {})
  if (issue) {
    const isSize = issue === 'size'
    throw createPaintingGenerateError(isSize ? 'SEEDREAM_INVALID_SIZE' : 'SEEDREAM_TRANSPARENT_PNG', {
      message: i18n.t(isSize ? 'paintings.seedream.invalid_size' : 'paintings.seedream.transparent_png'),
      presentation: 'toast'
    })
  }
}
