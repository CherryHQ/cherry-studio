import { loggerService } from '@logger'
import { useProviderActions, useProviders } from '@renderer/hooks/useProviders'
import { uuid } from '@renderer/utils'
import type { EndpointType } from '@shared/data/types/model'
import type { ApiKeyEntry, AuthConfig, EndpointConfig, Provider } from '@shared/data/types/provider'
import { useCallback, useRef, useState } from 'react'

import { clearProviderLogo, saveProviderLogo, useProviderLogo } from '../hooks/useProviderLogo'

const logger = loggerService.withContext('useProviderEditor')

export type ProviderEditorMode =
  | { kind: 'create-custom' }
  | { kind: 'duplicate'; source: Provider }
  | { kind: 'edit'; provider: Provider }

interface UseProviderEditorParams {
  onProviderCreated: (providerId: string) => void
}

export interface SubmitProviderEditorParams {
  name: string
  defaultChatEndpoint: EndpointType
  endpointConfigs?: Partial<Record<EndpointType, EndpointConfig>>
  presetProviderId?: string
  authConfig?: AuthConfig
  apiKeys?: ApiKeyEntry[]
  logo?: string | null
}

export type ProviderEditorSubmitNotice = 'create-logo-save-failed' | 'update-logo-save-failed'

export interface ProviderEditorSubmitResult {
  notice?: ProviderEditorSubmitNotice
}

export function useProviderEditor({ onProviderCreated }: UseProviderEditorParams) {
  const { createProvider } = useProviders()
  const { updateProviderById } = useProviderActions()
  const [mode, setMode] = useState<ProviderEditorMode | null>(null)
  const modeRef = useRef<ProviderEditorMode | null>(null)
  const submitTokenRef = useRef(0)
  const editingProvider = mode?.kind === 'edit' ? mode.provider : null
  const { logo: initialLogo } = useProviderLogo(editingProvider?.id)

  const updateMode = useCallback((next: ProviderEditorMode | null) => {
    submitTokenRef.current += 1
    modeRef.current = next
    setMode(next)
  }, [])

  const cancel = useCallback(() => updateMode(null), [updateMode])
  const startAdd = useCallback(() => updateMode({ kind: 'create-custom' }), [updateMode])
  const startAddFrom = useCallback((source: Provider) => updateMode({ kind: 'duplicate', source }), [updateMode])
  const startEdit = useCallback((provider: Provider) => updateMode({ kind: 'edit', provider }), [updateMode])

  const submit = useCallback(
    async ({
      name,
      defaultChatEndpoint,
      endpointConfigs,
      presetProviderId,
      authConfig,
      apiKeys,
      logo
    }: SubmitProviderEditorParams): Promise<ProviderEditorSubmitResult> => {
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

        if (modeRef.current?.kind === 'edit' && modeRef.current.provider.id === originalEditingId) {
          cancel()
        }
        return notice ? { notice } : {}
      }

      const providerId = uuid()
      const submitToken = ++submitTokenRef.current
      const provider = await createProvider({
        providerId,
        name: trimmedName,
        ...(presetProviderId ? { presetProviderId } : {}),
        defaultChatEndpoint,
        ...(endpointConfigs ? { endpointConfigs } : {}),
        ...(authConfig ? { authConfig } : {}),
        ...(apiKeys && apiKeys.length > 0 ? { apiKeys } : {})
      })
      let notice: ProviderEditorSubmitNotice | undefined

      if (logo) {
        try {
          await saveProviderLogo(providerId, logo)
        } catch (error) {
          logger.error('Failed to save logo', error as Error)
          notice = 'create-logo-save-failed'
        }
      }

      if (submitTokenRef.current === submitToken && modeRef.current?.kind !== 'edit') {
        onProviderCreated(provider.id)
        cancel()
      }
      return notice ? { notice } : {}
    },
    [cancel, createProvider, editingProvider, onProviderCreated, updateProviderById]
  )

  return {
    isOpen: mode != null,
    mode,
    editingProvider,
    initialLogo,
    startAdd,
    startAddFrom,
    startEdit,
    cancel,
    submit
  }
}
