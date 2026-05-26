import type { FileMetadata } from '@renderer/types'
import type { Provider } from '@shared/data/types/provider'
import type { TFunction } from 'i18next'

export function checkProviderEnabled(provider: Provider, t: TFunction): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const hasEnabledKey = provider.apiKeys.some((k) => k.isEnabled)
    if (provider.isEnabled && hasEnabledKey) {
      resolve(true)
      return
    }

    window.modal.warning({
      content: hasEnabledKey ? t('error.no_api_key') : t('error.provider_disabled'),
      centered: true,
      closable: true,
      okText: t('common.go_to_settings'),
      onOk: () => {
        void window.navigate?.({ to: `/settings/provider`, search: { id: provider.id } })
        reject('Provider disabled')
      },
      onCancel: () => reject('Provider disabled')
    })
  })
}

export function findPaintingByFiles<T extends { providerId?: string; files: ReadonlyArray<Pick<FileMetadata, 'id'>> }>(
  paintings: ReadonlyArray<T>,
  providerId: string,
  files: ReadonlyArray<Pick<FileMetadata, 'id'>>
): T | undefined {
  return paintings.find(
    (painting) =>
      painting.providerId === providerId &&
      painting.files.length === files.length &&
      painting.files.every((file, index) => file.id === files[index]?.id)
  )
}
