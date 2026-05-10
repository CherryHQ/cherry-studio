import i18n from '@renderer/i18n'
import NavigationService from '@renderer/services/NavigationService'

import type { PaintingGenerationGuardReason } from '../hooks/usePaintingGenerationGuard'
import { createPaintingGenerateError, presentPaintingGenerateError } from '../model/paintingGenerateError'

function openProviderSettings(providerId: string) {
  void NavigationService.navigate?.({ to: '/settings/provider', search: { id: providerId } })
}

export function presentPaintingGenerationGuardFeedback(
  reason: PaintingGenerationGuardReason,
  error?: Error,
  providerId?: string
) {
  if (reason === 'provider_disabled') {
    if (providerId) {
      window.modal.warning({
        content: i18n.t('error.provider_disabled'),
        centered: true,
        closable: true,
        okText: i18n.t('common.go_to_settings'),
        onOk: () => openProviderSettings(providerId)
      })
      return
    }
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
