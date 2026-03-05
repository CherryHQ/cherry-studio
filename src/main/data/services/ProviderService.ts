/**
 * Provider Service - handles provider CRUD operations
 *
 * Provides business logic for:
 * - Provider CRUD operations
 * - Row to Provider conversion
 */

import { CacheService } from '@data/CacheService'
import { dbService } from '@data/db/DbService'
import type { NewUserProvider, UserProvider } from '@data/db/schemas/userProvider'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateProviderDto, ListProvidersQuery, UpdateProviderDto } from '@shared/data/api/schemas/providers'
import type { AuthType, Provider, ProviderSettings, RuntimeApiCompatibility } from '@shared/data/types/provider'
import { DEFAULT_API_COMPATIBILITY, DEFAULT_PROVIDER_SETTINGS } from '@shared/data/types/provider'
import { eq } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:ProviderService')

/**
 * Convert database row to Provider entity
 */
function rowToRuntimeProvider(row: UserProvider): Provider {
  // Process API keys (strip actual key values for security)
  const apiKeys = (row.apiKeys ?? []).map(({ key: _key, ...rest }) => rest)

  // Determine auth type
  let authType: AuthType = 'api-key'
  if (row.authConfig?.type) {
    authType = row.authConfig.type as AuthType
  }

  // Merge API features
  const apiCompatibility: RuntimeApiCompatibility = {
    ...DEFAULT_API_COMPATIBILITY,
    ...row.apiCompatibility
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
    baseUrls: row.baseUrls ?? undefined,
    modelsApiUrls: row.modelsApiUrls ?? undefined,
    defaultChatEndpoint: row.defaultChatEndpoint ?? undefined,
    apiKeys,
    authType,
    apiCompatibility,
    settings,
    websites: row.websites ?? undefined,
    isEnabled: row.isEnabled ?? true
  }
}

export class ProviderService {
  private static instance: ProviderService

  private constructor() {}

  public static getInstance(): ProviderService {
    if (!ProviderService.instance) {
      ProviderService.instance = new ProviderService()
    }
    return ProviderService.instance
  }

  /**
   * List providers with optional filters
   */
  async list(query: ListProvidersQuery): Promise<Provider[]> {
    const db = dbService.getDb()

    let rows: UserProvider[]

    if (query.enabled !== undefined) {
      rows = await db
        .select()
        .from(userProviderTable)
        .where(eq(userProviderTable.isEnabled, query.enabled))
        .orderBy(userProviderTable.sortOrder)
    } else {
      rows = await db.select().from(userProviderTable).orderBy(userProviderTable.sortOrder)
    }

    return rows.map(rowToRuntimeProvider)
  }

  /**
   * Get a provider by its provider ID
   */
  async getByProviderId(providerId: string): Promise<Provider> {
    const db = dbService.getDb()

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
    const db = dbService.getDb()

    const values: NewUserProvider = {
      providerId: dto.providerId,
      presetProviderId: dto.presetProviderId ?? null,
      name: dto.name,
      baseUrls: dto.baseUrls ?? null,
      modelsApiUrls: dto.modelsApiUrls ?? null,
      defaultChatEndpoint: (dto.defaultChatEndpoint ?? null) as NewUserProvider['defaultChatEndpoint'],
      apiKeys: dto.apiKeys ?? [],
      authConfig: dto.authConfig ?? null,
      apiCompatibility: (dto.apiCompatibility ?? null) as NewUserProvider['apiCompatibility'],
      providerSettings: (dto.providerSettings ?? null) as NewUserProvider['providerSettings']
    }

    const [row] = await db.insert(userProviderTable).values(values).returning()

    logger.info('Created provider', { providerId: dto.providerId })

    return rowToRuntimeProvider(row)
  }

  /**
   * Update an existing provider
   */
  async update(providerId: string, dto: UpdateProviderDto): Promise<Provider> {
    const db = dbService.getDb()

    // Verify provider exists
    await this.getByProviderId(providerId)

    // Build update object
    const updates: Partial<NewUserProvider> = {}

    if (dto.name !== undefined) updates.name = dto.name
    if (dto.baseUrls !== undefined) updates.baseUrls = dto.baseUrls
    if (dto.modelsApiUrls !== undefined) updates.modelsApiUrls = dto.modelsApiUrls
    if (dto.defaultChatEndpoint !== undefined)
      updates.defaultChatEndpoint = dto.defaultChatEndpoint as NewUserProvider['defaultChatEndpoint']
    if (dto.apiKeys !== undefined) updates.apiKeys = dto.apiKeys
    if (dto.authConfig !== undefined) updates.authConfig = dto.authConfig
    if (dto.apiCompatibility !== undefined)
      updates.apiCompatibility = dto.apiCompatibility as NewUserProvider['apiCompatibility']
    if (dto.providerSettings !== undefined)
      updates.providerSettings = dto.providerSettings as NewUserProvider['providerSettings']
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
   * Batch upsert providers (used by CatalogService for preset providers)
   * Inserts new providers, updates only preset fields on existing ones.
   * Does NOT overwrite user-customized fields (apiKeys, isEnabled, sortOrder, authConfig).
   */
  async batchUpsert(providers: NewUserProvider[]): Promise<void> {
    if (providers.length === 0) return

    const db = dbService.getDb()

    for (const provider of providers) {
      await db
        .insert(userProviderTable)
        .values(provider)
        .onConflictDoUpdate({
          target: [userProviderTable.providerId],
          set: {
            presetProviderId: provider.presetProviderId,
            name: provider.name,
            baseUrls: provider.baseUrls,
            modelsApiUrls: provider.modelsApiUrls,
            defaultChatEndpoint: provider.defaultChatEndpoint,
            apiCompatibility: provider.apiCompatibility,
            providerSettings: provider.providerSettings,
            websites: provider.websites
          }
        })
    }

    logger.info('Batch upserted providers', { count: providers.length })
  }

  /**
   * Get a rotated API key for a provider (round-robin across enabled keys).
   * Returns empty string for providers that don't have keys.
   */
  async getRotatedApiKey(providerId: string): Promise<string> {
    const db = dbService.getDb()

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
    const cache = CacheService.getInstance()
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
  async getEnabledApiKeys(providerId: string): Promise<string[]> {
    const db = dbService.getDb()

    const [row] = await db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Provider', providerId)
    }

    return (row.apiKeys ?? []).filter((k) => k.isEnabled).map((k) => k.key)
  }

  /**
   * Add an API key to a provider. Skips if the key value already exists.
   * Returns the updated Provider.
   */
  async addApiKey(providerId: string, key: string, label?: string): Promise<Provider> {
    const db = dbService.getDb()

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
      isEnabled: true,
      createdAt: Date.now()
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
   * Delete a provider
   */
  async delete(providerId: string): Promise<void> {
    const db = dbService.getDb()

    // Verify provider exists
    await this.getByProviderId(providerId)

    await db.delete(userProviderTable).where(eq(userProviderTable.providerId, providerId))

    logger.info('Deleted provider', { providerId })
  }
}

export const providerService = ProviderService.getInstance()
