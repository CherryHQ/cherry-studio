import i18n from '@renderer/i18n'

import type { PaintingGenerationGuardReason } from '../hooks/usePaintingGenerationGuard'
import { createPaintingGenerateError, presentPaintingGenerateError } from '../model/paintingGenerateError'

export function presentPaintingGenerationGuardFeedback(reason: PaintingGenerationGuardReason, error?: Error) {
  if (reason === 'provider_disabled') {
    presentPaintingGenerateError(createPaintingGenerateError('PROVIDER_DISABLED'))
    return
  }
  if (reason === 'catalog_error') {
    window.toast.error(error?.message || i18n.t('paintings.req_error_model'))
    return
  }
  if (reason === 'model_unavailable') {
    window.toast.error(i18n.t('paintings.req_error_model'))
    return
  }
  window.toast.error(i18n.t('paintings.select_model'))
}
