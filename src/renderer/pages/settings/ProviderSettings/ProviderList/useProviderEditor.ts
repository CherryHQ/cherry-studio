import { useProviderActions, useProviders } from '@renderer/hooks/useProvider'
import { uuid } from '@renderer/utils/uuid'
import type { CreateLogoInput, UpdateLogoInput } from '@shared/data/api/schemas/logo'
import type { EndpointType } from '@shared/data/types/model'
import type { ApiKeyEntry, AuthConfig, EndpointConfig, Provider } from '@shared/data/types/provider'
import { useCallback, useRef, useState } from 'react'

/** Map the editor's flat `(logo, logoFileId)` intent to the create DTO union. */
function toCreateLogo(p: { logo?: string | null; logoFileId?: string | null }): CreateLogoInput | undefined {
  if (p.logoFileId) return { kind: 'file', fileId: p.logoFileId }
  if (p.logo) return { kind: 'key', key: p.logo }
  return undefined
}

/** Map the flat intent to the update DTO union (`null` → clear, omitted → unchanged). */
function toUpdateLogo(p: { logo?: string | null; logoFileId?: string | null }): UpdateLogoInput | undefined {
  if (p.logoFileId !== undefined)
    return p.logoFileId === null ? { kind: 'clear' } : { kind: 'file', fileId: p.logoFileId }
  if (p.logo !== undefined) return p.logo === null ? { kind: 'clear' } : { kind: 'key', key: p.logo }
  return undefined
}

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
      /** Preset id / url (`null` clears, omitted leaves unchanged). */
      logo?: string | null
      /** Pre-stored uploaded-logo file id (`null` clears, omitted leaves unchanged). */
      logoFileId?: string | null
    }
  | {
      mode: 'create'
      name: string
      defaultChatEndpoint: EndpointType
      endpointConfigs?: Partial<Record<EndpointType, EndpointConfig>>
      presetProviderId?: string
      authConfig?: AuthConfig
      apiKeys?: ApiKeyEntry[]
      /** Preset id / url. */
      logo?: string | null
      /** Pre-stored uploaded-logo file id. */
      logoFileId?: string | null
    }

export function useProviderEditor({ onProviderCreated }: UseProviderEditorParams) {
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
        // Logo persists atomically with the row: a preset key or an uploaded
        // file sets it, `clear` resets, omitted leaves it unchanged.
        const logo = toUpdateLogo(params)
        await updateProviderById(originalEditingId, {
          name: trimmedName,
          defaultChatEndpoint: params.defaultChatEndpoint,
          ...(logo !== undefined ? { logo } : {})
        })

        if (modeRef.current?.kind === 'edit' && modeRef.current.provider.id === originalEditingId) {
          cancel()
        }
        return
      }

      const providerId = uuid()
      const submitToken = ++submitTokenRef.current
      const logo = toCreateLogo(params)
      const provider = await createProvider({
        providerId,
        name: trimmedName,
        ...(params.presetProviderId ? { presetProviderId: params.presetProviderId } : {}),
        defaultChatEndpoint: params.defaultChatEndpoint,
        ...(params.endpointConfigs ? { endpointConfigs: params.endpointConfigs } : {}),
        ...(params.authConfig ? { authConfig: params.authConfig } : {}),
        ...(params.apiKeys && params.apiKeys.length > 0 ? { apiKeys: params.apiKeys } : {}),
        ...(logo ? { logo } : {})
      })

      if (submitTokenRef.current === submitToken && modeRef.current?.kind !== 'edit') {
        onProviderCreated(provider.id)
        cancel()
      }
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
