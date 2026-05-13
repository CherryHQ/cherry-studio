import i18n from '@renderer/i18n'
import { openSettingsWindow } from '@renderer/services/SettingsWindowService'

import type { PaintingGenerationGuardReason } from '../hooks/usePaintingGenerationGuard'
import { createPaintingGenerateError, presentPaintingGenerateError } from '../model/paintingGenerateError'

function openProviderSettings(providerId: string) {
  void openSettingsWindow(`/settings/provider?id=${encodeURIComponent(providerId)}`)
}

export function presentPaintingGenerationGuardFeedback(
  reason: PaintingGenerationGuardReason,
  error?: Error,
  providerId?: string
) {
  if (reason === 'provider_disabled' || reason === 'no_api_key') {
    if (providerId) {
      window.modal.warning({
        content: i18n.t(reason === 'provider_disabled' ? 'error.provider_disabled' : 'error.no_api_key'),
        centered: true,
        closable: true,
        okText: i18n.t('common.go_to_settings'),
        onOk: () => openProviderSettings(providerId)
      })
      return
    }
    presentPaintingGenerateError(
      createPaintingGenerateError(reason === 'provider_disabled' ? 'PROVIDER_DISABLED' : 'NO_API_KEY')
    )
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
