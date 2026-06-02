import i18next from 'i18next'
import { isEmpty } from 'lodash'

import { openSettingsWindow } from '../../../services/SettingsWindowService'
import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'

/**
 * Providers that run without an API key (local servers). Short-circuits the
 * apiKey check so canonicalGenerate's unconditional `checkProviderEnabled`
 * call doesn't trip on OVMS's local OpenVINO Model Server. Vendor adapter
 * knows not to attach an Authorization header.
 */
export const NO_AUTH_PROVIDER_IDS: ReadonlySet<string> = new Set(['ovms'])

function navigateToProviderSettings(providerId: string) {
  void openSettingsWindow(`/settings/provider?id=${encodeURIComponent(providerId)}`)
}

export async function checkProviderEnabled(provider: PaintingProviderRuntime): Promise<string> {
  if (NO_AUTH_PROVIDER_IDS.has(provider.id)) {
    return ''
  }

  if (!provider.isEnabled) {
    return new Promise((_, reject) => {
      window.modal.warning({
        content: i18next.t('error.provider_disabled'),
        centered: true,
        closable: true,
        okText: i18next.t('common.go_to_settings'),
        onOk: () => {
          navigateToProviderSettings(provider.id)
          reject('Provider disabled')
        },
        onCancel: () => reject('Provider disabled')
      })
    })
  }

  const apiKey = await provider.getApiKey()
  if (!isEmpty(apiKey)) {
    return apiKey
  }

  return new Promise((_, reject) => {
    window.modal.warning({
      content: i18next.t('error.no_api_key'),
      centered: true,
      closable: true,
      okText: i18next.t('common.go_to_settings'),
      onOk: () => {
        navigateToProviderSettings(provider.id)
        reject('No API key')
      },
      onCancel: () => reject('No API key')
    })
  })
}
