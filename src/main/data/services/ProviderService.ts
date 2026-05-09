/**
 * Provider Service - handles provider CRUD operations
 *
 * Provides business logic for:
 * - Provider CRUD operations
 * - Row to Provider conversion
 */

import { application } from '@application'
import { userModelTable } from '@data/db/schemas/userModel'
import type { NewUserProvider, UserProvider } from '@data/db/schemas/userProvider'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { pinService } from '@data/services/PinService'
import { applyMoves, insertManyWithOrderKey, insertWithOrderKey } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import { DataApiError, DataApiErrorFactory, ErrorCode } from '@shared/data/api'
import type { OrderBatchRequest, OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateProviderDto, ListProvidersQuery, UpdateProviderDto } from '@shared/data/api/schemas/providers'
import type {
  ApiKeyEntry,
  AuthConfig,
  AuthType,
  Provider,
  ProviderSettings,
  RuntimeApiFeatures
} from '@shared/data/types/provider'
import { DEFAULT_API_FEATURES, DEFAULT_PROVIDER_SETTINGS } from '@shared/data/types/provider'
import { asc, eq } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:ProviderService')

type NewUserProviderInput = Omit<NewUserProvider, 'orderKey'>

/**
 * Convert database row to Provider entity
 */
function rowToRuntimeProvider(row: UserProvider): Provider {
  // Process API keys (strip actual key values for security)
  // oxlint-disable-next-line no-unused-vars
  const apiKeys = (row.apiKeys ?? []).map(({ key: _key, ...rest }) => rest)

  // Determine auth type
  let authType: AuthType = 'api-key'
  if (row.authConfig?.type) {
    authType = row.authConfig.type
  }

  // Merge API features
  const apiFeatures: RuntimeApiFeatures = {
    ...DEFAULT_API_FEATURES,
    ...row.apiFeatures
  }

  // Merge settings
  const settings: ProviderSettings = {
    ...DEFAULT_PROVIDER_SETTINGS,
    ...(row.providerSettings as Partial<ProviderSettings> | null)
  }

  return {
    id: row.providerId,
    presetProviderId: row.presetProviderId ?? undefined,
    name: row.name,
    endpointConfigs: row.endpointConfigs ?? undefined,
    defaultChatEndpoint: row.defaultChatEndpoint ?? undefined,
    apiKeys,
    authType,
    apiFeatures,
    settings,
    isEnabled: row.isEnabled ?? true
  }
}

class ProviderService {
  private rethrowOrderError(error: unknown): never {
    if (
      error instanceof DataApiError &&
      error.code === ErrorCode.NOT_FOUND &&
      error.details?.resource === 'user_provider'
    ) {
      throw DataApiErrorFactory.notFound('Provider', error.details.id)
    }

    throw error
  }

  /**
   * List providers with optional filters
   */
  async list(query: ListProvidersQuery): Promise<Provider[]> {
    const db = application.get('DbService').getDb()

    let rows: UserProvider[]

    if (query.enabled !== undefined) {
      rows = await db
        .select()
        .from(userProviderTable)
        .where(eq(userProviderTable.isEnabled, query.enabled))
        .orderBy(asc(userProviderTable.orderKey))
    } else {
      rows = await db.select().from(userProviderTable).orderBy(asc(userProviderTable.orderKey))
    }

    return rows.map(rowToRuntimeProvider)
  }

  /**
   * Get a provider by its provider ID
   */
  async getByProviderId(providerId: string): Promise<Provider> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Provider', providerId)
    }

    return rowToRuntimeProvider(row)
  }

  /**
   * Create a new provider
   */
  async create(dto: CreateProviderDto): Promise<Provider> {
    const db = application.get('DbService').getDb()

    const values: NewUserProviderInput = {
      providerId: dto.providerId,
      presetProviderId: dto.presetProviderId ?? null,
      name: dto.name,
      endpointConfigs: dto.endpointConfigs ?? null,
      defaultChatEndpoint: dto.defaultChatEndpoint ?? null,
      apiKeys: dto.apiKeys ?? [],
      authConfig: dto.authConfig ?? null,
      apiFeatures: dto.apiFeatures ?? null,
      providerSettings: dto.providerSettings ?? null
    }

    const row = await db.transaction(async (tx) => {
      return (await insertWithOrderKey(tx, userProviderTable, values, {
        pkColumn: userProviderTable.providerId
      })) as UserProvider
    })

    logger.info('Created provider', { providerId: dto.providerId })

    return rowToRuntimeProvider(row)
  }

  /**
   * Update an existing provider
   */
  async update(providerId: string, dto: UpdateProviderDto): Promise<Provider> {
    const db = application.get('DbService').getDb()

    // Verify provider exists
    await this.getByProviderId(providerId)

    // Build update object
    const updates: Partial<NewUserProvider> = {}

    if (dto.name !== undefined) updates.name = dto.name
    if (dto.endpointConfigs !== undefined) updates.endpointConfigs = dto.endpointConfigs
    if (dto.defaultChatEndpoint !== undefined) updates.defaultChatEndpoint = dto.defaultChatEndpoint
    if (dto.apiKeys !== undefined) updates.apiKeys = dto.apiKeys
    if (dto.authConfig !== undefined) updates.authConfig = dto.authConfig
    if (dto.apiFeatures !== undefined) updates.apiFeatures = dto.apiFeatures
    if (dto.providerSettings !== undefined) updates.providerSettings = dto.providerSettings
    if (dto.isEnabled !== undefined) updates.isEnabled = dto.isEnabled

    const [row] = await db
      .update(userProviderTable)
      .set(updates)
      .where(eq(userProviderTable.providerId, providerId))
      .returning()

    logger.info('Updated provider', { providerId, changes: Object.keys(dto) })

    return rowToRuntimeProvider(row)
  }

  /**
   * Batch insert providers (used by PresetProviderSeeder for preset seeding).
   * Insert-only — existing providers are filtered out before order keys are assigned.
   * All user-customizable fields are preserved.
   */
  async batchUpsert(providers: NewUserProviderInput[]): Promise<void> {
    if (providers.length === 0) return

    const db = application.get('DbService').getDb()
    let insertedCount = 0
    await db.transaction(async (tx) => {
      const existing = await tx.select({ providerId: userProviderTable.providerId }).from(userProviderTable)
      const existingIds = new Set(existing.map((row) => row.providerId))
      const newProviders = providers.filter((provider) => !existingIds.has(provider.providerId))

      if (newProviders.length === 0) return

      await insertManyWithOrderKey(tx, userProviderTable, newProviders, {
        pkColumn: userProviderTable.providerId
      })
      insertedCount = newProviders.length
    })

    logger.info('Batch upserted providers', { insertedCount })
  }

  /**
   * Get a rotated API key for a provider (round-robin across enabled keys).
   * Returns empty string for providers that don't have keys.
   */
  async getRotatedApiKey(providerId: string): Promise<string> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Provider', providerId)
    }

    const enabledKeys = (row.apiKeys ?? []).filter((k) => k.isEnabled)

    if (enabledKeys.length === 0) {
      return ''
    }

    if (enabledKeys.length === 1) {
      return enabledKeys[0].key
    }

    // Round-robin using CacheService
    const cache = application.get('CacheService')
    const cacheKey = `provider:${providerId}:last_used_key_id`
    const lastUsedKeyId = cache.get<string>(cacheKey)

    if (!lastUsedKeyId) {
      cache.set(cacheKey, enabledKeys[0].id)
      return enabledKeys[0].key
    }

    const currentIndex = enabledKeys.findIndex((k) => k.id === lastUsedKeyId)
    const nextIndex = (currentIndex + 1) % enabledKeys.length
    const nextKey = enabledKeys[nextIndex]
    cache.set(cacheKey, nextKey.id)

    return nextKey.key
  }

  /**
   * Get all API keys for a provider.
   * Used by settings management UIs.
   */
  async getApiKeys(providerId: string): Promise<ApiKeyEntry[]> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Provider', providerId)
    }

    return row.apiKeys ?? []
  }

  /**
   * Get all enabled API key values for a provider.
   * Used by health check to test each key individually.
   */
  async getEnabledApiKeys(providerId: string): Promise<ApiKeyEntry[]> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Provider', providerId)
    }

    return (row.apiKeys ?? []).filter((k) => k.isEnabled)
  }

  /**
   * Get full auth config (includes sensitive credentials).
   */
  async getAuthConfig(providerId: string): Promise<AuthConfig | null> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Provider', providerId)
    }

    return row.authConfig ?? null
  }

  /**
   * Add an API key to a provider. Skips if the key value already exists.
   * Returns the updated Provider.
   */
  async addApiKey(providerId: string, key: string, label?: string): Promise<Provider> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Provider', providerId)
    }

    const existingKeys = row.apiKeys ?? []

    // Skip if key value already exists
    if (existingKeys.some((k) => k.key === key)) {
      logger.info('API key already exists, skipping', { providerId })
      return rowToRuntimeProvider(row)
    }

    const newEntry = {
      id: crypto.randomUUID(),
      key,
      ...(label ? { label } : {}),
      isEnabled: true
    }

    const updatedKeys = [...existingKeys, newEntry]

    const [updated] = await db
      .update(userProviderTable)
      .set({ apiKeys: updatedKeys })
      .where(eq(userProviderTable.providerId, providerId))
      .returning()

    logger.info('Added API key to provider', { providerId })

    return rowToRuntimeProvider(updated)
  }

  /**
   * Update a single API key entry by key ID.
   */
  async updateApiKey(
    providerId: string,
    keyId: string,
    updates: {
      key?: string
      label?: string
      isEnabled?: boolean
    }
  ): Promise<Provider> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Provider', providerId)
    }

    const existingKeys = row.apiKeys ?? []
    const keyIndex = existingKeys.findIndex((entry) => entry.id === keyId)

    if (keyIndex === -1) {
      throw DataApiErrorFactory.notFound('API key', keyId)
    }

    const nextKeyValue = updates.key?.trim()
    if (updates.key !== undefined && !nextKeyValue) {
      throw DataApiErrorFactory.validation({ key: ['API key cannot be empty'] })
    }

    if (nextKeyValue && existingKeys.some((entry, index) => index !== keyIndex && entry.key === nextKeyValue)) {
      throw DataApiErrorFactory.conflict('API key already exists', 'API key')
    }

    const updatedKeys = existingKeys.map((entry, index) => {
      if (index !== keyIndex) {
        return entry
      }

      const updatedEntry = {
        ...entry,
        ...(updates.isEnabled !== undefined ? { isEnabled: updates.isEnabled } : {}),
        ...(nextKeyValue ? { key: nextKeyValue } : {})
      }

      if (updates.label !== undefined) {
        if (updates.label) {
          updatedEntry.label = updates.label
        } else {
          delete updatedEntry.label
        }
      }

      return updatedEntry
    })

    const [updated] = await db
      .update(userProviderTable)
      .set({ apiKeys: updatedKeys })
      .where(eq(userProviderTable.providerId, providerId))
      .returning()

    logger.info('Updated API key', { providerId, keyId, changes: Object.keys(updates) })

    return rowToRuntimeProvider(updated)
  }

  /**
   * Delete an API key by key ID and return updated provider.
   */
  async deleteApiKey(providerId: string, keyId: string): Promise<Provider> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Provider', providerId)
    }

    const existingKeys = row.apiKeys ?? []
    const updatedKeys = existingKeys.filter((entry) => entry.id !== keyId)

    if (updatedKeys.length === existingKeys.length) {
      throw DataApiErrorFactory.notFound('API key', keyId)
    }

    const [updated] = await db
      .update(userProviderTable)
      .set({ apiKeys: updatedKeys })
      .where(eq(userProviderTable.providerId, providerId))
      .returning()

    logger.info('Deleted API key from provider', { providerId, keyId })

    return rowToRuntimeProvider(updated)
  }

  /**
   * Delete a provider. Canonical preset providers (where providerId === presetProviderId)
   * cannot be deleted. User-created providers that inherit from a preset can be deleted.
   */
  async delete(providerId: string): Promise<void> {
    const db = application.get('DbService').getDb()

    await db.transaction(async (tx) => {
      const [provider] = await tx
        .select({ presetProviderId: userProviderTable.presetProviderId })
        .from(userProviderTable)
        .where(eq(userProviderTable.providerId, providerId))
        .limit(1)

      if (!provider) {
        throw DataApiErrorFactory.notFound('Provider', providerId)
      }

      if (provider.presetProviderId && provider.presetProviderId === providerId) {
        throw DataApiErrorFactory.invalidOperation(`Cannot delete preset provider '${providerId}'`)
      }

      const models = await tx
        .select({ id: userModelTable.id })
        .from(userModelTable)
        .where(eq(userModelTable.providerId, providerId))

      await pinService.purgeForEntitiesTx(
        tx,
        'model',
        models.map((model) => model.id)
      )

      const deleted = await tx
        .delete(userProviderTable)
        .where(eq(userProviderTable.providerId, providerId))
        .returning({ providerId: userProviderTable.providerId })

      if (deleted.length === 0) {
        throw DataApiErrorFactory.notFound('Provider', providerId)
      }
    })

    logger.info('Deleted provider', { providerId })
  }

  async move(providerId: string, anchor: OrderRequest): Promise<void> {
    const db = application.get('DbService').getDb()

    try {
      await db.transaction(async (tx) => {
        await applyMoves(tx, userProviderTable, [{ id: providerId, anchor }], {
          pkColumn: userProviderTable.providerId
        })
      })
    } catch (error) {
      this.rethrowOrderError(error)
    }
    logger.info('Moved provider', { providerId, anchor })
  }

  async reorder(moves: OrderBatchRequest['moves']): Promise<void> {
    const db = application.get('DbService').getDb()

    try {
      await db.transaction(async (tx) => {
        await applyMoves(tx, userProviderTable, moves, {
          pkColumn: userProviderTable.providerId
        })
      })
    } catch (error) {
      this.rethrowOrderError(error)
    }
    logger.info('Reordered providers', { count: moves.length })
  }
}

export const providerService = new ProviderService()
