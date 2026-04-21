/**
 * Provider Service - handles provider CRUD operations
 *
 * Provides business logic for:
 * - Provider CRUD operations
 * - Row to Provider conversion
 */

import { application } from '@application'
import type { NewUserProvider, UserProvider } from '@data/db/schemas/userProvider'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { applyMoves, insertManyWithOrderKey, insertWithOrderKey } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
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
  private get db() {
    return application.get('DbService').getDb()
  }

  private rethrowOrderError(error: unknown): never {
    if (error instanceof Error) {
      const moveTargetMatch = error.message.match(/move target id "(.+)" not found/)
      if (moveTargetMatch) {
        throw DataApiErrorFactory.notFound('Provider', moveTargetMatch[1])
      }

      const anchorMatch = error.message.match(/anchor id "(.+)" .* not found/)
      if (anchorMatch) {
        throw DataApiErrorFactory.notFound('Provider', anchorMatch[1])
      }

      if (error.message.includes("cannot equal the move's own id")) {
        throw DataApiErrorFactory.invalidOperation(error.message)
      }
    }

    throw error
  }

  private async listRows(): Promise<UserProvider[]> {
    return this.db.select().from(userProviderTable).orderBy(asc(userProviderTable.orderKey))
  }

  /**
   * List providers with optional filters
   */
  async list(query: ListProvidersQuery): Promise<Provider[]> {
    let rows: UserProvider[]

    if (query.enabled !== undefined) {
      rows = await this.db
        .select()
        .from(userProviderTable)
        .where(eq(userProviderTable.isEnabled, query.enabled))
        .orderBy(asc(userProviderTable.orderKey))
    } else {
      rows = await this.listRows()
    }

    return rows.map(rowToRuntimeProvider)
  }

  /**
   * Get a provider by its provider ID
   */
  async getByProviderId(providerId: string): Promise<Provider> {
    const [row] = await this.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, providerId))
      .limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Provider', providerId)
    }

    return rowToRuntimeProvider(row)
  }

  /**
   * Create a new provider
   */
  async create(dto: CreateProviderDto): Promise<Provider> {
    const values: NewUserProvider = {
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

    const row = (await insertWithOrderKey(this.db, userProviderTable, values, {
      pkColumn: userProviderTable.providerId
    })) as UserProvider

    logger.info('Created provider', { providerId: dto.providerId })

    return rowToRuntimeProvider(row)
  }

  /**
   * Update an existing provider
   */
  async update(providerId: string, dto: UpdateProviderDto): Promise<Provider> {
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

    const [row] = await this.db
      .update(userProviderTable)
      .set(updates)
      .where(eq(userProviderTable.providerId, providerId))
      .returning()

    logger.info('Updated provider', { providerId, changes: Object.keys(dto) })

    return rowToRuntimeProvider(row)
  }

  /**
   * Batch insert providers (used by PresetProviderSeeder for preset seeding).
   * Insert-only — existing providers are silently skipped via onConflictDoNothing.
   * All user-customizable fields are preserved.
   */
  async batchUpsert(providers: NewUserProvider[]): Promise<void> {
    if (providers.length === 0) return

    const existing = await this.db.select({ providerId: userProviderTable.providerId }).from(userProviderTable)
    const existingIds = new Set(existing.map((row) => row.providerId))
    const newProviders = providers.filter((provider) => !existingIds.has(provider.providerId))

    if (newProviders.length === 0) return

    await insertManyWithOrderKey(this.db, userProviderTable, newProviders, {
      pkColumn: userProviderTable.providerId
    })

    logger.info('Batch upserted providers', { count: newProviders.length })
  }

  /**
   * Get a rotated API key for a provider (round-robin across enabled keys).
   * Returns empty string for providers that don't have keys.
   */
  async getRotatedApiKey(providerId: string): Promise<string> {
    const [row] = await this.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, providerId))
      .limit(1)

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
   * Get all enabled API key values for a provider.
   * Used by health check to test each key individually.
   */
  async getEnabledApiKeys(providerId: string): Promise<ApiKeyEntry[]> {
    const [row] = await this.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, providerId))
      .limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Provider', providerId)
    }

    return (row.apiKeys ?? []).filter((k) => k.isEnabled)
  }

  /**
   * Get full auth config (includes sensitive credentials).
   */
  async getAuthConfig(providerId: string): Promise<AuthConfig | null> {
    const [row] = await this.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, providerId))
      .limit(1)

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
    const [row] = await this.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, providerId))
      .limit(1)

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
      label,
      isEnabled: true
    }

    const updatedKeys = [...existingKeys, newEntry]

    const [updated] = await this.db
      .update(userProviderTable)
      .set({ apiKeys: updatedKeys })
      .where(eq(userProviderTable.providerId, providerId))
      .returning()

    logger.info('Added API key to provider', { providerId })

    return rowToRuntimeProvider(updated)
  }

  /**
   * Delete an API key by key ID and return updated provider.
   */
  async deleteApiKey(providerId: string, keyId: string): Promise<Provider> {
    const [row] = await this.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, providerId))
      .limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Provider', providerId)
    }

    const existingKeys = row.apiKeys ?? []
    const updatedKeys = existingKeys.filter((entry) => entry.id !== keyId)

    if (updatedKeys.length === existingKeys.length) {
      throw DataApiErrorFactory.notFound('API key', keyId)
    }

    const [updated] = await this.db
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
    const provider = await this.getByProviderId(providerId)

    if (provider.presetProviderId && provider.presetProviderId === providerId) {
      throw DataApiErrorFactory.invalidOperation(`Cannot delete preset provider '${providerId}'`)
    }

    await this.db.delete(userProviderTable).where(eq(userProviderTable.providerId, providerId))

    logger.info('Deleted provider', { providerId })
  }

  async move(providerId: string, anchor: OrderRequest): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
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
    try {
      await this.db.transaction(async (tx) => {
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
