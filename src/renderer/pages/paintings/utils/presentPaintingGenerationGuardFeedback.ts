import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { popup } from '@renderer/services/popup'
import { openSettingsWindow } from '@renderer/services/SettingsWindowService'
import { toast } from '@renderer/services/toast'

import { createPaintingGenerateError, presentPaintingGenerateError } from '../errors/paintingGenerateError'
import type { PaintingGenerationGuardReason } from '../hooks/usePaintingGenerationGuard'

const logger = loggerService.withContext('paintings')

function openProviderSettings(providerId: string) {
  openSettingsWindow(`/settings/provider?id=${encodeURIComponent(providerId)}`).catch((error) => {
    logger.error('Failed to open provider settings window', error)
  })
}

export function presentPaintingGenerationGuardFeedback(
  reason: PaintingGenerationGuardReason,
  error?: Error,
  providerId?: string
) {
  if (reason === 'provider_disabled' || reason === 'no_api_key') {
    if (providerId) {
      popup.warning({
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
    toast.error(error?.message || i18n.t('paintings.req_error_model'))
    return
  }
  if (reason === 'model_unavailable') {
    toast.error(i18n.t('paintings.req_error_model'))
    return
  }
  toast.error(i18n.t('paintings.select_model'))
}
