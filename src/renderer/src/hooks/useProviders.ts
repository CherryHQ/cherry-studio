import { dataApiService } from '@data/DataApiService'
import { useInvalidateCache, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { CreateProviderDto, ListProvidersQuery, UpdateProviderDto } from '@shared/data/api/schemas/providers'
import type { Model } from '@shared/data/types/model'
import type { ApiKeyEntry, AuthConfig, Provider } from '@shared/data/types/provider'
import { useCallback, useMemo } from 'react'

const REFRESH_PROVIDERS = ['/providers'] as const
const EMPTY_PROVIDERS: Provider[] = []
const logger = loggerService.withContext('useProviders')

// Provider reorder is intentionally omitted here until a transactional batch endpoint exists.
// Sending N independent PATCH requests can leave persistent partial state on failure.

/** Provider IDs are system-defined simple strings (no `/` or special chars),
 *  so standard `:providerId` params need no encoding. */
function providerPath(providerId: string): ConcreteApiPaths {
  return `/providers/${providerId}` as ConcreteApiPaths
}

function providerAuthConfigPath(providerId: string): ConcreteApiPaths {
  return `/providers/${providerId}/auth-config` as ConcreteApiPaths
}

function providerApiKeysPath(providerId: string): ConcreteApiPaths {
  return `/providers/${providerId}/api-keys` as ConcreteApiPaths
}

function providerApiKeyPath(providerId: string, keyId: string): ConcreteApiPaths {
  return `/providers/${providerId}/api-keys/${keyId}` as ConcreteApiPaths
}

function providerRegistryModelsPath(providerId: string): ConcreteApiPaths {
  return `/providers/${providerId}/registry-models` as ConcreteApiPaths
}

// ─── Layer 1: List + Create ────────────────────────────────────────────
export function useProviders(query?: ListProvidersQuery) {
  const { data, isLoading, mutate } = useQuery('/providers', query ? { query } : undefined)

  const { trigger: createTrigger } = useMutation('POST', '/providers', {
    refresh: [...REFRESH_PROVIDERS]
  })

  const addProvider = useCallback(
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

  const providers = useMemo(() => data ?? EMPTY_PROVIDERS, [data])

  return {
    providers,
    isLoading,
    addProvider,
    refetch: mutate
  }
}

// ─── Layer 2: Single read + write + delete ────────────────────────────
export function useProvider(providerId: string) {
  const result = useQuery(providerPath(providerId))
  // Dynamic path loses type inference; cast matches schema: GET /providers/:id -> Provider
  const data = result.data as Provider | undefined
  const { isLoading } = result

  const mutations = useProviderMutations(providerId)

  return { provider: data, isLoading, ...mutations }
}

// ─── Layer 3: Pure mutations ──────────────────────────────────────────
export function useProviderMutations(providerId: string) {
  const path = providerPath(providerId)
  const invalidate = useInvalidateCache()

  const { trigger: patchTrigger } = useMutation('PATCH', path, {
    refresh: [...REFRESH_PROVIDERS]
  })

  const { trigger: deleteTrigger } = useMutation('DELETE', path, {
    refresh: [...REFRESH_PROVIDERS]
  })

  const updateProvider = useCallback(
    async (updates: UpdateProviderDto) => {
      try {
        return await patchTrigger({ body: updates })
      } catch (error) {
        logger.error('Failed to update provider', { providerId, error })
        throw error
      }
    },
    [patchTrigger, providerId]
  )

  const deleteProvider = useCallback(async () => {
    try {
      return await deleteTrigger()
    } catch (error) {
      logger.error('Failed to delete provider', { providerId, error })
      throw error
    }
  }, [deleteTrigger, providerId])

  const updateAuthConfig = useCallback(
    async (authConfig: AuthConfig) => {
      try {
        await patchTrigger({ body: { authConfig } })
        await invalidate(providerAuthConfigPath(providerId))
      } catch (error) {
        logger.error('Failed to update auth config', { providerId, error })
        throw error
      }
    },
    [patchTrigger, invalidate, providerId]
  )

  const addApiKey = useCallback(
    async (key: string, label?: string) => {
      try {
        await dataApiService.post(providerApiKeysPath(providerId), {
          body: { key, label }
        })
        await invalidate([providerPath(providerId), providerApiKeysPath(providerId), '/providers'])
      } catch (error) {
        logger.error('Failed to add API key', { providerId, error })
        throw error
      }
    },
    [providerId, invalidate]
  )

  const deleteApiKey = useCallback(
    async (keyId: string) => {
      try {
        await dataApiService.delete(providerApiKeyPath(providerId, keyId))
        await invalidate([providerPath(providerId), providerApiKeysPath(providerId), '/providers'])
      } catch (error) {
        logger.error('Failed to delete API key', { providerId, keyId, error })
        throw error
      }
    },
    [providerId, invalidate]
  )

  const updateApiKeys = useCallback(
    async (apiKeys: ApiKeyEntry[]) => {
      try {
        await patchTrigger({ body: { apiKeys } })
        await invalidate(providerApiKeysPath(providerId))
      } catch (error) {
        logger.error('Failed to update API keys', { providerId, error })
        throw error
      }
    },
    [patchTrigger, invalidate, providerId]
  )

  return { updateProvider, deleteProvider, updateAuthConfig, updateApiKeys, addApiKey, deleteApiKey }
}

// ─── Typed query helpers ─────────────────────────────────────────────
export function useProviderAuthConfig(providerId: string) {
  const result = useQuery(providerAuthConfigPath(providerId))
  // Schema: GET /providers/:id/auth-config -> AuthConfig | null
  return { ...result, data: result.data as AuthConfig | null | undefined }
}

export function useProviderApiKeys(providerId: string) {
  const result = useQuery(providerApiKeysPath(providerId))
  // Schema: GET /providers/:id/api-keys -> { keys: ApiKeyEntry[] }
  return { ...result, data: result.data as { keys: ApiKeyEntry[] } | undefined }
}

export function useProviderRegistryModels(providerId: string) {
  const result = useQuery(providerRegistryModelsPath(providerId))
  // Schema: GET /providers/:id/registry-models -> Model[]
  return { ...result, data: result.data as Model[] | undefined }
}

// ─── Dynamic ID operations (for context menus, URL schema handlers) ──
export function useProviderActions() {
  const invalidate = useInvalidateCache()

  const updateProviderById = useCallback(
    async (providerId: string, updates: UpdateProviderDto) => {
      try {
        await dataApiService.patch(providerPath(providerId), { body: updates })
        await invalidate('/providers')
      } catch (error) {
        logger.error('Failed to update provider', { providerId, error })
        throw error
      }
    },
    [invalidate]
  )

  const deleteProviderById = useCallback(
    async (providerId: string) => {
      try {
        await dataApiService.delete(providerPath(providerId))
        await invalidate('/providers')
      } catch (error) {
        logger.error('Failed to delete provider', { providerId, error })
        throw error
      }
    },
    [invalidate]
  )

  return { updateProviderById, deleteProviderById }
}
