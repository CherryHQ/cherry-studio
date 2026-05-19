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

/**
 * Discriminated by `mode` so the type system enforces per-mode field
 * validity: `edit` only carries name/endpoint/logo, while `create` (covers
 * both create-custom and duplicate) carries the full creation payload. The
 * branch decision lives in the params, not a closure.
 */
export type SubmitProviderEditorParams =
  | { mode: 'edit'; name: string; defaultChatEndpoint: EndpointType; logo?: string | null }
  | {
      mode: 'create'
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
    async (params: SubmitProviderEditorParams): Promise<ProviderEditorSubmitResult> => {
      const trimmedName = params.name.trim()
      if (!trimmedName) {
        return {}
      }

      if (params.mode === 'edit') {
        if (!editingProvider) {
          return {}
        }
        const originalEditingId = editingProvider.id
        await updateProviderById(originalEditingId, {
          name: trimmedName,
          defaultChatEndpoint: params.defaultChatEndpoint
        })
        let notice: ProviderEditorSubmitNotice | undefined

        if (params.logo !== undefined) {
          if (params.logo) {
            try {
              await saveProviderLogo(originalEditingId, params.logo)
            } catch (error) {
              logger.error('Failed to save logo', error as Error)
              notice = 'update-logo-save-failed'
            }
          } else {
            try {
              await clearProviderLogo(originalEditingId)
            } catch (error) {
              logger.error('Failed to reset logo', error as Error)
              // Same surfaced toast as the save-logo failure — clearing is
              // still a logo update; without this the failure is silent.
              notice = 'update-logo-save-failed'
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
        ...(params.presetProviderId ? { presetProviderId: params.presetProviderId } : {}),
        defaultChatEndpoint: params.defaultChatEndpoint,
        ...(params.endpointConfigs ? { endpointConfigs: params.endpointConfigs } : {}),
        ...(params.authConfig ? { authConfig: params.authConfig } : {}),
        ...(params.apiKeys && params.apiKeys.length > 0 ? { apiKeys: params.apiKeys } : {})
      })
      let notice: ProviderEditorSubmitNotice | undefined

      if (params.logo) {
        try {
          await saveProviderLogo(providerId, params.logo)
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
