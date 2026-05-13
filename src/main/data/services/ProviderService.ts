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
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
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
import { and, eq, sql, type SQLWrapper } from 'drizzle-orm'

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
    isEnabled: row.isEnabled
  }
}

class ProviderService {
  /**
   * List providers with optional filters
   */
  async list(query: ListProvidersQuery): Promise<Provider[]> {
    const db = application.get('DbService').getDb()

    const conditions: SQLWrapper[] = []

    if (query.enabled !== undefined) {
      conditions.push(eq(userProviderTable.isEnabled, query.enabled))
    }

    if (query.endpointType !== undefined) {
      // endpointConfigs is a JSON text column: { "anthropic-messages": {...}, "openai-chat": {...} }
      // Check if the key exists and is not null
      conditions.push(sql`json_extract(${userProviderTable.endpointConfigs}, ${'$.' + query.endpointType}) IS NOT NULL`)
    }

    const rows =
      conditions.length > 0
        ? await db
            .select()
            .from(userProviderTable)
            .where(and(...conditions))
            .orderBy(userProviderTable.sortOrder)
        : await db.select().from(userProviderTable).orderBy(userProviderTable.sortOrder)

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

    const [row] = await db.insert(userProviderTable).values(values).returning()

    logger.info('Created provider', { providerId: dto.providerId })

    return rowToRuntimeProvider(row)
  }

  /**
   * Update an existing provider
   */
  async update(providerId: string, dto: UpdateProviderDto): Promise<Provider> {
    const db = application.get('DbService').getDb()

    // Verify provider exists and keep its merged settings for patch-style updates.
    const currentProvider = await this.getByProviderId(providerId)

    // Build update object
    const updates: Partial<NewUserProvider> = {}

    if (dto.name !== undefined) updates.name = dto.name
    if (dto.endpointConfigs !== undefined) updates.endpointConfigs = dto.endpointConfigs
    if (dto.defaultChatEndpoint !== undefined) updates.defaultChatEndpoint = dto.defaultChatEndpoint
    if (dto.apiKeys !== undefined) updates.apiKeys = dto.apiKeys
    if (dto.authConfig !== undefined) updates.authConfig = dto.authConfig
    if (dto.apiFeatures !== undefined) updates.apiFeatures = dto.apiFeatures
    if (dto.providerSettings !== undefined) {
      updates.providerSettings = {
        ...currentProvider.settings,
        ...dto.providerSettings
      }
    }
    if (dto.isEnabled !== undefined) updates.isEnabled = dto.isEnabled
    if (dto.sortOrder !== undefined) updates.sortOrder = dto.sortOrder

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
   * Insert-only — existing providers are silently skipped via onConflictDoNothing.
   * All user-customizable fields are preserved.
   */
  async batchUpsert(providers: NewUserProvider[]): Promise<void> {
    if (providers.length === 0) return

    const db = application.get('DbService').getDb()

    await db.transaction(async (tx) => {
      for (const provider of providers) {
        await tx.insert(userProviderTable).values(provider).onConflictDoNothing()
      }
    })

    logger.info('Batch upserted providers', { count: providers.length })
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
      label,
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
}

export const providerService = new ProviderService()
