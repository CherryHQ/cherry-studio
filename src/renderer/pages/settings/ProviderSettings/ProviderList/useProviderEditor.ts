import { loggerService } from '@logger'
import { useProviderActions, useProviders } from '@renderer/hooks/useProvider'
import { ipcApi } from '@renderer/ipc'
import { uuid } from '@renderer/utils/uuid'
import type { EndpointType } from '@shared/data/types/model'
import type { ApiKeyEntry, AuthConfig, EndpointConfig, Provider } from '@shared/data/types/provider'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useProviderEditor')

/**
 * A provider logo edit: upload bytes (sent raw to `provider.set_logo`), a preset
 * key, or clear. `undefined` means "leave unchanged".
 */
export type ProviderLogoEdit = { kind: 'image'; file: File } | { kind: 'key'; key: string } | { kind: 'clear' }

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
  | {
      mode: 'edit'
      name: string
      defaultChatEndpoint: EndpointType
      /** Logo edit; omitted leaves it unchanged. */
      logo?: ProviderLogoEdit
    }
  | {
      mode: 'create'
      name: string
      defaultChatEndpoint: EndpointType
      endpointConfigs?: Partial<Record<EndpointType, EndpointConfig>>
      presetProviderId?: string
      authConfig?: AuthConfig
      apiKeys?: ApiKeyEntry[]
      /** Logo for the new provider (preset key inline; an upload via the command). */
      logo?: ProviderLogoEdit
    }

export function useProviderEditor({ onProviderCreated }: UseProviderEditorParams) {
  const { t } = useTranslation()
  const { createProvider } = useProviders()
  const { updateProviderById } = useProviderActions()
  const [mode, setMode] = useState<ProviderEditorMode | null>(null)
  const modeRef = useRef<ProviderEditorMode | null>(null)
  const submitTokenRef = useRef(0)
  const editingProvider = mode?.kind === 'edit' ? mode.provider : null
  const initialLogo = editingProvider?.logo

  const updateMode = useCallback((next: ProviderEditorMode | null) => {
    submitTokenRef.current += 1
    modeRef.current = next
    setMode(next)
  }, [])

  const cancel = useCallback(() => updateMode(null), [updateMode])
  const startAdd = useCallback(() => updateMode({ kind: 'create-custom' }), [updateMode])
  const startAddFrom = useCallback((source: Provider) => updateMode({ kind: 'duplicate', source }), [updateMode])
  const startEdit = useCallback((provider: Provider) => updateMode({ kind: 'edit', provider }), [updateMode])

  // Apply a logo edit through the dedicated command: the renderer sends raw
  // bytes / intent, main creates the file_entry, binds it, and compensates on
  // failure. A logo failure is surfaced with a logo-specific toast and does NOT
  // fail the row save (the provider is already persisted).
  const applyLogo = useCallback(
    async (providerId: string, edit: ProviderLogoEdit) => {
      const image =
        edit.kind === 'image'
          ? ({ kind: 'image', data: new Uint8Array(await edit.file.arrayBuffer()) } as const)
          : edit.kind === 'key'
            ? ({ kind: 'key', key: edit.key } as const)
            : ({ kind: 'clear' } as const)
      try {
        await ipcApi.request('provider.set_logo', { providerId, image })
      } catch (error) {
        logger.error('Failed to set provider logo', error as Error)
        window.toast.error(t('settings.provider.logo_upload_failed'))
      }
    },
    [t]
  )

  const submit = useCallback(
    async (params: SubmitProviderEditorParams): Promise<void> => {
      const trimmedName = params.name.trim()
      if (!trimmedName) {
        return
      }

      if (params.mode === 'edit') {
        if (!editingProvider) {
          return
        }
        const originalEditingId = editingProvider.id
        await updateProviderById(originalEditingId, {
          name: trimmedName,
          defaultChatEndpoint: params.defaultChatEndpoint
        })
        if (params.logo) {
          await applyLogo(originalEditingId, params.logo)
        }

        if (modeRef.current?.kind === 'edit' && modeRef.current.provider.id === originalEditingId) {
          cancel()
        }
        return
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
        ...(params.apiKeys && params.apiKeys.length > 0 ? { apiKeys: params.apiKeys } : {}),
        // Preset-key logo persists atomically with the row; an upload is applied
        // via the command below. A `clear` on create is a no-op (default icon).
        ...(params.logo?.kind === 'key' ? { logo: { kind: 'key', key: params.logo.key } } : {})
      })

      if (params.logo?.kind === 'image') {
        await applyLogo(provider.id, params.logo)
      }

      if (submitTokenRef.current === submitToken && modeRef.current?.kind !== 'edit') {
        onProviderCreated(provider.id)
        cancel()
      }
    },
    [applyLogo, cancel, createProvider, editingProvider, onProviderCreated, updateProviderById]
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
