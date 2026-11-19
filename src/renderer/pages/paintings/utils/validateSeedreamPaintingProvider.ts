import i18n from '@renderer/i18n/resolver'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'
import { isSeedream5xTargetModel } from '@shared/ai/seedreamImageContract'

import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'

export function validateSeedreamPaintingProvider(
  modelId: string | undefined,
  provider: Pick<PaintingProviderRuntime, 'id' | 'presetProviderId'>
): void {
  if (isSeedream5xTargetModel(modelId ?? '') && (provider.presetProviderId ?? provider.id) === 'dmxapi') {
    throw createPaintingGenerateError('REMOTE_ERROR', {
      message: i18n.t('paintings.seedream.dmxapi_unsupported'),
      presentation: 'toast'
    })
  }
}
