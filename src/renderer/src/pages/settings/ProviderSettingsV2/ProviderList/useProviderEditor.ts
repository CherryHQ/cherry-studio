import { loggerService } from '@logger'
import { useProviderActions, useProviders } from '@renderer/hooks/useProviders'
import { uuid } from '@renderer/utils'
import type { EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { useCallback, useState } from 'react'

import { clearProviderLogo, saveProviderLogo, useProviderLogo } from '../hooks/useProviderLogo'

const logger = loggerService.withContext('useProviderEditor')

interface UseProviderEditorParams {
  onProviderCreated: (providerId: string) => void
}

export interface SubmitProviderEditorParams {
  name: string
  defaultChatEndpoint: EndpointType
  logo?: string | null
}

export type ProviderEditorSubmitNotice = 'create-logo-save-failed' | 'update-logo-save-failed'

export interface ProviderEditorSubmitResult {
  notice?: ProviderEditorSubmitNotice
}

export function useProviderEditor({ onProviderCreated }: UseProviderEditorParams) {
  const { createProvider } = useProviders()
  const { updateProviderById } = useProviderActions()
  const [addingProvider, setAddingProvider] = useState(false)
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const { logo: initialLogo } = useProviderLogo(editingProvider?.id)

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
    async ({ name, defaultChatEndpoint, logo }: SubmitProviderEditorParams): Promise<ProviderEditorSubmitResult> => {
      const trimmedName = name.trim()
      if (!trimmedName) {
        return {}
      }

      if (editingProvider) {
        await updateProviderById(editingProvider.id, { name: trimmedName, defaultChatEndpoint })
        let notice: ProviderEditorSubmitNotice | undefined

        if (logo !== undefined) {
          if (logo) {
            try {
              await saveProviderLogo(editingProvider.id, logo)
            } catch (error) {
              logger.error('Failed to save logo', error as Error)
              notice = 'update-logo-save-failed'
            }
          } else {
            try {
              await clearProviderLogo(editingProvider.id)
            } catch (error) {
              logger.error('Failed to reset logo', error as Error)
            }
          }
        }

        cancel()
        return notice ? { notice } : {}
      }

      const providerId = uuid()
      const provider = await createProvider({ providerId, name: trimmedName, defaultChatEndpoint })
      let notice: ProviderEditorSubmitNotice | undefined

      if (logo) {
        try {
          await saveProviderLogo(providerId, logo)
        } catch (error) {
          logger.error('Failed to save logo', error as Error)
          notice = 'create-logo-save-failed'
        }
      }

      onProviderCreated(provider.id)
      cancel()
      return notice ? { notice } : {}
    },
    [cancel, createProvider, editingProvider, onProviderCreated, updateProviderById]
  )

  return {
    isOpen: addingProvider || editingProvider != null,
    editingProvider,
    initialLogo,
    startAdd,
    startEdit,
    cancel,
    submit
  }
}
