import { dataApiService } from '@data/DataApiService'
import { useInvalidateCache, useMutation, useQuery } from '@data/hooks/useDataApi'
import type { CreateProviderDto, UpdateProviderDto } from '@shared/data/api/schemas/providers'
import type { Model } from '@shared/data/types/model'
import type { ApiKeyEntry, AuthConfig, Provider } from '@shared/data/types/provider'
import { useCallback, useMemo } from 'react'

const REFRESH_PROVIDERS = ['/providers'] as const
const EMPTY_PROVIDERS: Provider[] = []

// ─── Layer 1: List + Create + Reorder ─────────────────────────────────
export function useProviders(query?: { enabled?: boolean }) {
  const { data, isLoading, mutate } = useQuery('/providers', query ? { query } : undefined)

  const { trigger: createTrigger } = useMutation('POST', '/providers', {
    refresh: [...REFRESH_PROVIDERS]
  })

  const addProvider = useCallback((dto: CreateProviderDto) => createTrigger({ body: dto }), [createTrigger])

  const reorderProviders = useCallback(
    async (reorderedList: Provider[]) => {
      void mutate(reorderedList as any, false) // optimistic
      try {
        await Promise.all(
          reorderedList.map((p, i) => dataApiService.patch(`/providers/${p.id}` as const, { body: { sortOrder: i } }))
        )
        void mutate()
      } catch {
        void mutate()
      }
    },
    [mutate]
  )

  const providers = useMemo(() => data ?? EMPTY_PROVIDERS, [data])

  return {
    providers,
    isLoading,
    addProvider,
    reorderProviders,
    refetch: mutate
  }
}

// ─── Layer 2: Single read + write + delete ────────────────────────────
export function useProvider(providerId: string) {
  const { data, isLoading } = useQuery(`/providers/${providerId}` as const) as {
    data: Provider | undefined
    isLoading: boolean
    [k: string]: any
  }

  const mutations = useProviderMutations(providerId)

  return { provider: data, isLoading, ...mutations }
}

// ─── Layer 3: Pure mutations ──────────────────────────────────────────
export function useProviderMutations(providerId: string) {
  const path = `/providers/${providerId}` as const
  const invalidate = useInvalidateCache()

  const { trigger: patchTrigger } = useMutation('PATCH', path, {
    refresh: [...REFRESH_PROVIDERS]
  })

  const { trigger: deleteTrigger } = useMutation('DELETE', path, {
    refresh: [...REFRESH_PROVIDERS]
  })

  const updateProvider = useCallback((updates: UpdateProviderDto) => patchTrigger({ body: updates }), [patchTrigger])

  const deleteProvider = useCallback(() => deleteTrigger(), [deleteTrigger])

  const updateAuthConfig = useCallback(
    async (authConfig: AuthConfig) => {
      await patchTrigger({ body: { authConfig } })
      await invalidate(`/providers/${providerId}/auth-config`)
    },
    [patchTrigger, invalidate, providerId]
  )

  const addApiKey = useCallback(
    async (key: string, label?: string) => {
      await dataApiService.post(`/providers/${providerId}/api-keys` as const, {
        body: { key, label }
      })
      await invalidate([`/providers/${providerId}`, `/providers/${providerId}/api-keys`, '/providers'])
    },
    [providerId, invalidate]
  )

  const deleteApiKey = useCallback(
    async (keyId: string) => {
      await dataApiService.delete(`/providers/${providerId}/api-keys/${keyId}` as const)
      await invalidate([`/providers/${providerId}`, `/providers/${providerId}/api-keys`, '/providers'])
    },
    [providerId, invalidate]
  )

  const updateApiKeys = useCallback(
    async (apiKeys: ApiKeyEntry[]) => {
      await patchTrigger({ body: { apiKeys } })
      await invalidate(`/providers/${providerId}/api-keys`)
    },
    [patchTrigger, invalidate, providerId]
  )

  return { updateProvider, deleteProvider, updateAuthConfig, updateApiKeys, addApiKey, deleteApiKey }
}

// ─── Typed query helpers ─────────────────────────────────────────────
export function useProviderAuthConfig(providerId: string) {
  return useQuery(`/providers/${providerId}/auth-config` as const) as {
    data: AuthConfig | null | undefined
    isLoading: boolean
    [k: string]: any
  }
}

export function useProviderApiKeys(providerId: string) {
  return useQuery(`/providers/${providerId}/api-keys` as const) as {
    data: { keys: ApiKeyEntry[] } | undefined
    isLoading: boolean
    [k: string]: any
  }
}

export function useProviderRegistryModels(providerId: string) {
  return useQuery(`/providers/${providerId}/registry-models` as const) as {
    data: Model[] | undefined
    isLoading: boolean
    [k: string]: any
  }
}

// ─── Dynamic ID operations (for context menus, URL schema handlers) ──
export function useProviderActions() {
  const invalidate = useInvalidateCache()

  const patchProviderById = useCallback(
    async (providerId: string, updates: UpdateProviderDto) => {
      await dataApiService.patch(`/providers/${providerId}` as const, { body: updates })
      await invalidate('/providers')
    },
    [invalidate]
  )

  const deleteProviderById = useCallback(
    async (providerId: string) => {
      await dataApiService.delete(`/providers/${providerId}` as const)
      await invalidate('/providers')
    },
    [invalidate]
  )

  return { patchProviderById, deleteProviderById }
}
