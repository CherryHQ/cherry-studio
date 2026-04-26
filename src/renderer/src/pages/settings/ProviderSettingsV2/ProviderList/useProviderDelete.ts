import { loggerService } from '@logger'
import type { Provider } from '@shared/data/types/provider'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useProviderDelete')

interface UseProviderDeleteParams {
  deleteProviderById: (providerId: string) => Promise<unknown>
  clearLogo: (providerId: string) => Promise<void>
  providers: Provider[]
  onSelectProvider: (providerId: string) => void
}

export function useProviderDelete({
  deleteProviderById,
  clearLogo,
  providers,
  onSelectProvider
}: UseProviderDeleteParams) {
  const { t } = useTranslation()

  const deleteProvider = useCallback(
    async (provider: Provider) => {
      window.modal.confirm({
        title: t('settings.provider.delete.title'),
        content: t('settings.provider.delete.content'),
        okButtonProps: { danger: true },
        okText: t('common.delete'),
        centered: true,
        onOk: async () => {
          try {
            await clearLogo(provider.id)
          } catch (error) {
            logger.error('Failed to delete logo', error as Error)
          }

          onSelectProvider(providers.find((item) => item.id !== provider.id)?.id ?? '')
          await deleteProviderById(provider.id)
        }
      })
    },
    [clearLogo, deleteProviderById, onSelectProvider, providers, t]
  )

  return { deleteProvider }
}
