import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { getProviderLabel } from '@renderer/i18n/label'
import { isSystemProviderId } from '@renderer/types/provider'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { CreateProviderDto, ListProvidersQuery, UpdateProviderDto } from '@shared/data/api/schemas/providers'
import type { ApiKeyEntry, AuthConfig, Provider } from '@shared/data/types/provider'
import { isUndefined, omitBy } from 'lodash'
import { useCallback } from 'react'

const EMPTY_PROVIDERS: Provider[] = []
const logger = loggerService.withContext('useProviders')

// Provider reorder is intentionally omitted here until a transactional batch endpoint exists.
// Sending N independent PATCH requests can leave persistent partial state on failure.

/**
 * All SWR cache keys that must revalidate after any mutation to a provider:
 * - `/providers` — the list
 * - `/providers/${id}` — the entity (useProvider)
 * - `/providers/${id}/*` — all sub-resources (api-keys, auth-config, registry-models, …)
 *
 * Concrete paths are only needed here for SWR refresh arrays — queries and mutations
 * use schema template paths directly, so no `as ConcreteApiPaths` casts are needed there.
 */
function providerRefreshPaths(providerId: string): ConcreteApiPaths[] {
  return [
    '/providers',
    `/providers/${providerId}` as ConcreteApiPaths,
    `/providers/${providerId}/*` as ConcreteApiPaths
  ]
}

// ─── Layer 1: List + Create ────────────────────────────────────────────
export function useProviders(query?: ListProvidersQuery) {
  const filtered = query ? (omitBy(query, isUndefined) as ListProvidersQuery) : undefined
  const queryOptions = filtered && Object.keys(filtered).length > 0 ? { query: filtered } : undefined

  const { data, isLoading, refetch } = useQuery('/providers', queryOptions)

  const {
    trigger: createTrigger,
    isLoading: isCreating,
    error: createError
  } = useMutation('POST', '/providers', {
    refresh: ['/providers']
  })

  const createProvider = useCallback(
    async (dto: CreateProviderDto) => {
      try {
        return await createTrigger({ body: dto })
      } catch (error) {
        logger.error('Failed to create provider', { providerId: dto.providerId, error })
        throw error
      }
    },
    [createTrigger]
  )

  const providers = data ?? EMPTY_PROVIDERS

  return {
    providers,
    isLoading,
    createProvider,
    isCreating,
    createError,
    refetch
  }
}

// ─── Layer 2: Single read + write + delete ────────────────────────────
export function useProvider(providerId: string | null | undefined) {
  const resolvedProviderId = providerId ?? ''
  const { data, isLoading, error, refetch } = useQuery('/providers/:providerId', {
    params: { providerId: resolvedProviderId },
    enabled: !!providerId
  })
  const provider = data

  const mutations = useProviderMutations(resolvedProviderId)

  return { provider, isLoading, error, refetch, ...mutations }
}

// ─── Layer 3: Pure mutations ──────────────────────────────────────────
export function useProviderMutations(providerId: string) {
  // P0: all mutations refresh list + entity + all sub-paths — no manual invalidate needed.
  const refresh = providerRefreshPaths(providerId)

  const {
    trigger: patchTrigger,
    isLoading: isUpdating,
    error: updateError
  } = useMutation('PATCH', '/providers/:providerId', { refresh })

  const {
    trigger: deleteTrigger,
    isLoading: isDeleting,
    error: deleteError
  } = useMutation('DELETE', '/providers/:providerId', { refresh })

  // addApiKey/deleteApiKey use template paths so body/response types are schema-inferred.
  const {
    trigger: addApiKeyTrigger,
    isLoading: isAddingApiKey,
    error: addApiKeyError
  } = useMutation('POST', '/providers/:providerId/api-keys', { refresh })

  const {
    trigger: deleteApiKeyTrigger,
    isLoading: isDeletingApiKey,
    error: deleteApiKeyError
  } = useMutation('DELETE', '/providers/:providerId/api-keys/:keyId', { refresh })

  const updateProvider = useCallback(
    async (updates: UpdateProviderDto) => {
      try {
        return await patchTrigger({ params: { providerId }, body: updates })
      } catch (error) {
        logger.error('Failed to update provider', { providerId, error })
        throw error
      }
    },
    [patchTrigger, providerId]
  )

  const deleteProvider = useCallback(async () => {
    try {
      return await deleteTrigger({ params: { providerId } })
    } catch (error) {
      logger.error('Failed to delete provider', { providerId, error })
      throw error
    }
  }, [deleteTrigger, providerId])

  const updateAuthConfig = useCallback(
    async (authConfig: AuthConfig) => {
      try {
        await patchTrigger({ params: { providerId }, body: { authConfig } })
      } catch (error) {
        logger.error('Failed to update auth config', { providerId, error })
        throw error
      }
    },
    [patchTrigger, providerId]
  )

  const addApiKey = useCallback(
    async (key: string, label?: string) => {
      try {
        await addApiKeyTrigger({ params: { providerId }, body: { key, label } })
      } catch (error) {
        logger.error('Failed to add API key', { providerId, error })
        throw error
      }
    },
    [addApiKeyTrigger, providerId]
  )

  const deleteApiKey = useCallback(
    async (keyId: string) => {
      try {
        await deleteApiKeyTrigger({ params: { providerId, keyId } })
      } catch (error) {
        logger.error('Failed to delete API key', { providerId, keyId, error })
        throw error
      }
    },
    [deleteApiKeyTrigger, providerId]
  )

  const updateApiKeys = useCallback(
    async (apiKeys: ApiKeyEntry[]) => {
      try {
        await patchTrigger({ params: { providerId }, body: { apiKeys } })
      } catch (error) {
        logger.error('Failed to update API keys', { providerId, error })
        throw error
      }
    },
    [patchTrigger, providerId]
  )

  return {
    updateProvider,
    isUpdating,
    updateError,
    deleteProvider,
    isDeleting,
    deleteError,
    updateAuthConfig,
    addApiKey,
    isAddingApiKey,
    addApiKeyError,
    deleteApiKey,
    isDeletingApiKey,
    deleteApiKeyError,
    updateApiKeys
  }
}

// ─── Typed query helpers ─────────────────────────────────────────────
export function useProviderAuthConfig(providerId: string) {
  const result = useQuery('/providers/:providerId/auth-config', { params: { providerId } })
  // Schema: GET /providers/:id/auth-config -> AuthConfig | null
  return { ...result, data: result.data }
}

export function useProviderApiKeys(providerId: string) {
  return useQuery('/providers/:providerId/api-keys', { params: { providerId } })
}

export function useProviderRegistryModels(providerId: string) {
  const result = useQuery('/providers/:providerId/registry-models', { params: { providerId } })
  // Schema: GET /providers/:id/registry-models -> Model[]
  return { ...result, data: result.data }
}

/**
 * Pure resolver for a provider's display name. System providers get the
 * i18n label; custom providers use their user-set name. Returns empty
 * string when the provider is missing.
 */
export function getProviderDisplayName(provider: Provider | undefined): string {
  if (!provider) return ''
  return isSystemProviderId(provider.id) ? getProviderLabel(provider.id) : provider.name
}

/**
 * Hook variant of {@link getProviderDisplayName} for callers that have a
 * single provider id. For batch rendering (e.g. a dropdown of N providers),
 * use `useProviders()` + `getProviderDisplayName` to avoid hook-in-loop.
 */
export function useProviderDisplayName(providerId: string | undefined): string {
  const { data: provider } = useQuery('/providers/:providerId', {
    params: { providerId: providerId ?? '' },
    enabled: !!providerId
  })
  return getProviderDisplayName(provider)
}

// ─── Dynamic ID operations (for context menus, URL schema handlers) ──
export function useProviderActions() {
  // Template paths: providerId is supplied per-call via params, so one hook
  // instance handles any provider ID without needing concrete-path rebinding.
  const { trigger: updateTrigger } = useMutation('PATCH', '/providers/:providerId', {
    // args is always present — callers always supply params.providerId
    refresh: ({ args }) => providerRefreshPaths(args!.params.providerId)
  })

  const { trigger: deleteTrigger } = useMutation('DELETE', '/providers/:providerId', {
    // args is always present — callers always supply params.providerId
    refresh: ({ args }) => providerRefreshPaths(args!.params.providerId)
  })

  const updateProviderById = useCallback(
    async (providerId: string, updates: UpdateProviderDto) => {
      try {
        return await updateTrigger({ params: { providerId }, body: updates })
      } catch (error) {
        logger.error('Failed to update provider', { providerId, error })
        throw error
      }
    },
    [updateTrigger]
  )

  const deleteProviderById = useCallback(
    async (providerId: string) => {
      try {
        return await deleteTrigger({ params: { providerId } })
      } catch (error) {
        logger.error('Failed to delete provider', { providerId, error })
        throw error
      }
    },
    [deleteTrigger]
  )

  return { updateProviderById, deleteProviderById }
}
