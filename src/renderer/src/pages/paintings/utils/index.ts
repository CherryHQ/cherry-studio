import type { Provider } from '@renderer/types'
import type { FileEntry } from '@shared/data/types/file'
import type { TFunction } from 'i18next'
import { isEmpty } from 'lodash'

type NavigateToProviderSettings = (providerId: string) => void | Promise<void>

export function checkProviderEnabled(
  provider: Provider,
  t: TFunction,
  navigateToProviderSettings?: NavigateToProviderSettings
): Promise<boolean> {
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
        if (navigateToProviderSettings) {
          void navigateToProviderSettings(provider.id)
        } else {
          void window.navigate?.({ to: '/settings/provider', search: { id: provider.id } })
        }
        reject('Provider disabled')
      },
      onCancel: () => reject('Provider disabled')
    })
  })
}

export function findPaintingByFiles<T extends { providerId?: string; files: ReadonlyArray<Pick<FileEntry, 'id'>> }>(
  paintings: ReadonlyArray<T>,
  providerId: string,
  files: ReadonlyArray<Pick<FileEntry, 'id'>>
): T | undefined {
  return paintings.find(
    (painting) =>
      painting.providerId === providerId &&
      painting.files.length === files.length &&
      painting.files.every((file, index) => file.id === files[index]?.id)
  )
}
