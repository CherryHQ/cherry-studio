import type { Provider } from '@renderer/types'
import i18next from 'i18next'
import { isEmpty } from 'lodash'

export function checkProviderEnabled(provider: Provider): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (provider.enabled && !isEmpty(provider.apiKey)) {
      resolve(true)
      return
    }

    window.modal.warning({
      content: provider.apiKey ? i18next.t('error.no_api_key') : i18next.t('error.provider_disabled'),
      centered: true,
      closable: true,
      okText: i18next.t('common.go_to_settings'),
      onOk: () => {
        void window.navigate?.({ to: `/settings/provider`, search: { id: provider.id } })
        reject('Provider disabled')
      },
      onCancel: () => reject('Provider disabled')
    })
  })
}
