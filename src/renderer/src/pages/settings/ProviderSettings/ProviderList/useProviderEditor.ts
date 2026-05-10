import { loggerService } from '@logger'
import { useProviderActions, useProviders } from '@renderer/hooks/useProviders'
import { uuid } from '@renderer/utils'
import type { EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { useCallback, useRef, useState } from 'react'

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
  const editingProviderRef = useRef<Provider | null>(null)
  const { logo: initialLogo } = useProviderLogo(editingProvider?.id)

  const cancel = useCallback(() => {
    setAddingProvider(false)
    setEditingProvider(null)
    editingProviderRef.current = null
  }, [])

  const startAdd = useCallback(() => {
    setAddingProvider(true)
    setEditingProvider(null)
    editingProviderRef.current = null
  }, [])

  const startEdit = useCallback((provider: Provider) => {
    setAddingProvider(false)
    setEditingProvider(provider)
    editingProviderRef.current = provider
  }, [])

  const submit = useCallback(
    async ({ name, defaultChatEndpoint, logo }: SubmitProviderEditorParams): Promise<ProviderEditorSubmitResult> => {
      const trimmedName = name.trim()
      if (!trimmedName) {
        return {}
      }

      if (editingProvider) {
        const originalEditingId = editingProvider.id
        await updateProviderById(originalEditingId, { name: trimmedName, defaultChatEndpoint })
        let notice: ProviderEditorSubmitNotice | undefined

        if (logo !== undefined) {
          if (logo) {
            try {
              await saveProviderLogo(originalEditingId, logo)
            } catch (error) {
              logger.error('Failed to save logo', error as Error)
              notice = 'update-logo-save-failed'
            }
          } else {
            try {
              await clearProviderLogo(originalEditingId)
            } catch (error) {
              logger.error('Failed to reset logo', error as Error)
            }
          }
        }

        if (editingProviderRef.current?.id === originalEditingId) {
          cancel()
        }
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
