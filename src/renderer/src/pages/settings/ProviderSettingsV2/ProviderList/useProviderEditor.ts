import { loggerService } from '@logger'
import { uuid } from '@renderer/utils'
import type { EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useProviderEditor')

interface UseProviderEditorParams {
  createProvider: (dto: { providerId: string; name: string; defaultChatEndpoint: EndpointType }) => Promise<Provider>
  updateProviderById: (
    providerId: string,
    updates: { name: string; defaultChatEndpoint: EndpointType }
  ) => Promise<unknown>
  saveLogo: (providerId: string, logo: string) => Promise<void>
  clearLogo: (providerId: string) => Promise<void>
  onSelectProvider: (providerId: string) => void
}

export interface SubmitProviderEditorParams {
  name: string
  defaultChatEndpoint: EndpointType
  logo?: string | null
}

export function useProviderEditor({
  createProvider,
  updateProviderById,
  saveLogo,
  clearLogo,
  onSelectProvider
}: UseProviderEditorParams) {
  const { t } = useTranslation()
  const [addingProvider, setAddingProvider] = useState(false)
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)

  const cancel = useCallback(() => {
    setAddingProvider(false)
    setEditingProvider(null)
  }, [])

  const startAdd = useCallback(() => {
    setAddingProvider(true)
    setEditingProvider(null)
  }, [])

  const startEdit = useCallback((provider: Provider) => {
    setAddingProvider(false)
    setEditingProvider(provider)
  }, [])

  const submit = useCallback(
    async ({ name, defaultChatEndpoint, logo }: SubmitProviderEditorParams) => {
      const trimmedName = name.trim()
      if (!trimmedName) {
        return
      }

      if (editingProvider) {
        await updateProviderById(editingProvider.id, { name: trimmedName, defaultChatEndpoint })

        if (logo !== undefined) {
          if (logo) {
            try {
              await saveLogo(editingProvider.id, logo)
            } catch (error) {
              logger.error('Failed to save logo', error as Error)
              window.toast.error(t('message.error.update_provider_logo'))
            }
          } else {
            try {
              await clearLogo(editingProvider.id)
            } catch (error) {
              logger.error('Failed to reset logo', error as Error)
            }
          }
        }

        cancel()
        return
      }

      const providerId = uuid()
      const provider = await createProvider({ providerId, name: trimmedName, defaultChatEndpoint })

      if (logo) {
        try {
          await saveLogo(providerId, logo)
        } catch (error) {
          logger.error('Failed to save logo', error as Error)
          window.toast.error(t('message.error.save_provider_logo'))
        }
      }

      onSelectProvider(provider.id)
      cancel()
    },
    [cancel, clearLogo, createProvider, editingProvider, onSelectProvider, saveLogo, t, updateProviderById]
  )

  return { isOpen: addingProvider || editingProvider != null, editingProvider, startAdd, startEdit, cancel, submit }
}
