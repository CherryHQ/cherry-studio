import i18next from 'i18next'
import { isEmpty } from 'lodash'

import NavigationService from '../../../services/NavigationService'
import type { PaintingProviderRuntime } from '../model/types/paintingProviderRuntime'

function navigateToProviderSettings(providerId: string) {
  void NavigationService.navigate?.({ to: '/settings/provider', search: { id: providerId } })
}

export async function checkProviderEnabled(provider: PaintingProviderRuntime): Promise<string> {
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
        reject('Provider disabled')
      },
      onCancel: () => reject('Provider disabled')
    })
  })
}
