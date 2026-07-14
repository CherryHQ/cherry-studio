import i18n from '@renderer/i18n/resolver'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'

import { createPaintingGenerateError, presentPaintingGenerateError } from '../errors/paintingGenerateError'
import type { PaintingGenerationGuardReason } from '../hooks/usePaintingGenerationGuard'

function openProviderSettings(providerId: string) {
  openSettingsTab(`/settings/provider?id=${encodeURIComponent(providerId)}`)
}

export async function presentPaintingGenerationGuardFeedback(
  reason: PaintingGenerationGuardReason,
  error?: Error,
  providerId?: string
) {
  if (reason === 'provider_disabled') {
    if (providerId) {
      if (
        await popup.warning({
          content: i18n.t('error.provider_disabled'),
          centered: true,
          closable: true,
          okText: i18n.t('common.go_to_settings')
        })
      ) {
        openProviderSettings(providerId)
      }
      return
    }
    presentPaintingGenerateError(createPaintingGenerateError('PROVIDER_DISABLED'))
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
