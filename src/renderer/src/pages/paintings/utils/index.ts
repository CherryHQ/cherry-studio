import type { Provider } from '@renderer/types'
import type { TFunction } from 'i18next'
import { isEmpty } from 'lodash'

export function checkProviderEnabled(provider: Provider, t: TFunction): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (provider.enabled && !isEmpty(provider.apiKey)) {
      resolve(true)
      return
    }

    window.modal.warning({
      content: provider.apiKey ? t('error.no_api_key') : t('error.provider_disabled'),
      centered: true,
      closable: true,
      okText: t('common.go_to_settings'),
      onOk: () => {
        window.navigate?.({ to: `/settings/provider`, search: { id: provider.id } })
        reject('Provider disabled')
      },
      onCancel: () => reject('Provider disabled')
    })
  })
}
