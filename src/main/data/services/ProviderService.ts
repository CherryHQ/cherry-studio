/**
 * Provider Service - handles provider CRUD operations
 *
 * Provides business logic for:
 * - Provider CRUD operations
 * - Row to Provider conversion
 */

import { application } from '@application'
import { userModelTable } from '@data/db/schemas/userModel'
import type { InsertUserProviderRow, UserProviderRow } from '@data/db/schemas/userProvider'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { type SqliteErrorHandlers, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbType } from '@data/db/types'
import { getDataService, registerDataService } from '@data/services/dataServiceRegistry'
import { pinService } from '@data/services/PinService'
import { applyMoves, insertManyWithOrderKey, insertWithOrderKey } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import { DataApiError, DataApiErrorFactory, ErrorCode } from '@shared/data/api/errors'
import type { OrderBatchRequest, OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateProviderDto, ListProvidersQuery, UpdateProviderDto } from '@shared/data/api/schemas/providers'
import { isManagedCherryAiProviderId } from '@shared/data/presets/cherryai'
import type {
  ApiKeyEntry,
  AuthConfig,
  AuthType,
  Provider,
  ProviderSettings,
  RuntimeApiFeatures
} from '@shared/data/types/provider'
import { DEFAULT_API_FEATURES, DEFAULT_PROVIDER_SETTINGS } from '@shared/data/types/provider'
import { and, asc, eq, sql, type SQLWrapper } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('DataApi:ProviderService')

type NewUserProviderInput = Omit<InsertUserProviderRow, 'orderKey'>

function assertManagedCherryAiProviderPatchAllowed(providerId: string, dto: UpdateProviderDto): void {
  if (!isManagedCherryAiProviderId(providerId) || Object.keys(dto).length === 0) {
    return
  }

  assertManagedCherryAiProviderMutationAllowed(providerId, `update provider ${providerId}`)
}

function assertManagedCherryAiProviderMutationAllowed(providerId: string, operation: string): void {
  if (!isManagedCherryAiProviderId(providerId)) {
    return
  }

  throw DataApiErrorFactory.invalidOperation(operation, 'managed CherryAI provider cannot be modified')
}

function normalizeApiKeyEntry(entry: ApiKeyEntry): ApiKeyEntry {
  const key = entry.key.trim()
  if (!key) {
    throw DataApiErrorFactory.validation({ key: ['API key cannot be empty'] })
  }

  return {
    id: entry.id,
    key,
    ...(entry.label ? { label: entry.label } : {}),
    isEnabled: entry.isEnabled
  }
}

function normalizeApiKeyEntries(apiKeys: ApiKeyEntry[]): ApiKeyEntry[] {
  const seenKeys = new Set<string>()
  const seenIds = new Set<string>()
  return apiKeys.map((entry) => {
    const normalized = normalizeApiKeyEntry(entry)
    if (seenKeys.has(normalized.key)) {
      throw DataApiErrorFactory.conflict('API key already exists', 'API key')
    }
    if (seenIds.has(normalized.id)) {
      throw DataApiErrorFactory.conflict('API key id already exists', 'API key')
    }
    seenKeys.add(normalized.key)
    seenIds.add(normalized.id)
    return normalized
  })
}

/**
 * Convert database row to Provider entity
 */
function rowToRuntimeProvider(row: UserProviderRow): Provider {
  const providerRegistryService = getDataService('ProviderRegistryService')
  const presetMetadata = providerRegistryService.getProviderDisplayMetadata(
    row.providerId,
    row.presetProviderId ?? undefined
  )

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
    description: presetMetadata.description,
    websites: presetMetadata.websites,
    endpointConfigs: row.endpointConfigs ?? undefined,
    defaultChatEndpoint: row.defaultChatEndpoint ?? undefined,
    modelListSource: presetMetadata.modelListSource,
    authMethods: presetMetadata.authMethods,
    apiKeys,
    authType,
    apiFeatures,
    settings,
    isEnabled: row.isEnabled
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
  list(query: ListProvidersQuery): Provider[] {
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
        ? db
            .select()
            .from(userProviderTable)
            .where(and(...conditions))
            .orderBy(asc(userProviderTable.orderKey))
            .all()
        : db.select().from(userProviderTable).orderBy(asc(userProviderTable.orderKey)).all()

    return rows.map(rowToRuntimeProvider)
  }

  /**
   * Get a provider by its provider ID
   */
  getByProviderId(providerId: string): Provider {
    const db = application.get('DbService').getDb()
    const [row] = db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId)).limit(1).all()

    if (!row) {
      throw DataApiErrorFactory.notFound('Provider', providerId)
    }

    return rowToRuntimeProvider(row)
  }

  /**
   * Create a new provider
   */
  create(dto: CreateProviderDto): Provider {
    assertManagedCherryAiProviderMutationAllowed(dto.providerId, `create provider ${dto.providerId}`)

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
      providerSettings: dto.providerSettings ?? null,
      isEnabled: false
    }

    const row = withSqliteErrors(
      () =>
        db.transaction((tx) => {
          return insertWithOrderKey(tx, userProviderTable, values, {
            pkColumn: userProviderTable.providerId
          }) as UserProviderRow
        }),
      {
        unique: () => DataApiErrorFactory.conflict(`Provider '${dto.providerId}' already exists`, 'Provider')
      } satisfies SqliteErrorHandlers
    )

    logger.info('Created provider', { providerId: dto.providerId })

    return rowToRuntimeProvider(row)
  }

  /**
   * Update an existing provider
   */
  update(providerId: string, dto: UpdateProviderDto): Provider {
    assertManagedCherryAiProviderPatchAllowed(providerId, dto)

    // Read + merge + write the providerSettings JSON in ONE serialized write
    // transaction. A bare read-then-update would let two concurrent PATCHes both
    // read the same old providerSettings and have the later write clobber the
    // other's keys (lost update); withWriteTx serializes them so each merges on
    // the latest row value.
    const row = application.get('DbService').withWriteTx((tx) => {
      // Read the raw row's providerSettings, not the merged entity. PATCH
      // semantics require merging with the stored partial, not with runtime
      // defaults — otherwise DEFAULT_PROVIDER_SETTINGS would be persisted
      // into the row and break the "row stores only overrides" contract.
      const [current] = tx
        .select({ providerSettings: userProviderTable.providerSettings })
        .from(userProviderTable)
        .where(eq(userProviderTable.providerId, providerId))
        .limit(1)
        .all()

      if (!current) {
        throw DataApiErrorFactory.notFound('Provider', providerId)
      }

      const updates: Partial<InsertUserProviderRow> = {}

      if (dto.name !== undefined) updates.name = dto.name
      if (dto.endpointConfigs !== undefined) updates.endpointConfigs = dto.endpointConfigs
      if (dto.defaultChatEndpoint !== undefined) updates.defaultChatEndpoint = dto.defaultChatEndpoint
      if (dto.authConfig !== undefined) updates.authConfig = dto.authConfig
      if (dto.apiFeatures !== undefined) updates.apiFeatures = dto.apiFeatures
      if (dto.providerSettings !== undefined) {
        updates.providerSettings = {
          ...(current.providerSettings as Partial<ProviderSettings> | null),
          ...dto.providerSettings
        }
      }
      if (dto.isEnabled !== undefined) updates.isEnabled = dto.isEnabled

      const [updated] = tx
        .update(userProviderTable)
        .set(updates)
        .where(eq(userProviderTable.providerId, providerId))
        .returning()
        .all()

      if (!updated) {
        throw DataApiErrorFactory.notFound('Provider', providerId)
      }
      return updated
    })

    logger.info('Updated provider', { providerId, changes: Object.keys(dto) })

    return rowToRuntimeProvider(row)
  }

  /**
   * Batch insert providers (used by PresetProviderSeeder for preset seeding).
   * Insert-only — existing providers are filtered out before order keys are assigned.
   * All user-customizable fields are preserved.
   */
  batchUpsert(providers: NewUserProviderInput[]): void {
    if (providers.length === 0) return

    const db = application.get('DbService').getDb()
    const insertedCount = db.transaction((tx) => this.batchUpsertTx(tx, providers))

    logger.info('Batch upserted providers', { insertedCount })
  }

  batchUpsertTx(tx: Pick<DbType, 'select' | 'insert'>, providers: NewUserProviderInput[]): number {
    const existing = tx.select({ providerId: userProviderTable.providerId }).from(userProviderTable).all()
    const existingIds = new Set(existing.map((row) => row.providerId))
    const newProviders = providers.filter((provider) => !existingIds.has(provider.providerId))

    if (newProviders.length === 0) return 0

    insertManyWithOrderKey(tx, userProviderTable, newProviders, {
      pkColumn: userProviderTable.providerId
    })
    return newProviders.length
  }

  /**
   * Get a rotated API key for a provider (round-robin across enabled keys).
   * Returns empty string for providers that don't have keys.
   */
  getRotatedApiKey(providerId: string): string {
    const db = application.get('DbService').getDb()
    const [row] = db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId)).limit(1).all()

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
    const cacheKey = `settings.provider.${providerId}.last_used_key_id`
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
   * Get API keys for a provider.
   *
   * Pass `{ enabled: true }` to filter to enabled keys only (e.g. health check
   * iteration, rotation consumers); omit it to get all keys (settings management
   * UI that needs to preserve disabled entries).
   */
  getApiKeys(providerId: string, options: { enabled?: boolean } = {}): ApiKeyEntry[] {
    const db = application.get('DbService').getDb()
    const [row] = db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId)).limit(1).all()

    if (!row) {
      throw DataApiErrorFactory.notFound('Provider', providerId)
    }

    const apiKeys = row.apiKeys ?? []
    return options.enabled ? apiKeys.filter((k) => k.isEnabled) : apiKeys
  }

  /**
   * Get full auth config (includes sensitive credentials).
   */
  getAuthConfig(providerId: string): AuthConfig | null {
    const db = application.get('DbService').getDb()
    const [row] = db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId)).limit(1).all()

    if (!row) {
      throw DataApiErrorFactory.notFound('Provider', providerId)
    }

    return row.authConfig ?? null
  }

  /**
   * Add an API key to a provider. Skips if the key value already exists.
   * Returns the updated Provider.
   */
  addApiKey(providerId: string, key: string, label?: string): Provider {
    assertManagedCherryAiProviderMutationAllowed(providerId, `add API key to provider ${providerId}`)

    const db = application.get('DbService').getDb()
    const { provider, added } = db.transaction((tx) => {
      const [row] = tx
        .select()
        .from(userProviderTable)
        .where(eq(userProviderTable.providerId, providerId))
        .limit(1)
        .all()

      if (!row) {
        throw DataApiErrorFactory.notFound('Provider', providerId)
      }

      const existingKeys = row.apiKeys ?? []

      // Skip if key value already exists
      if (existingKeys.some((k) => k.key === key)) {
        return { provider: rowToRuntimeProvider(row), added: false }
      }

      const newEntry = {
        id: uuidv4(),
        key,
        ...(label ? { label } : {}),
        isEnabled: true
      }

      const updatedKeys = [...existingKeys, newEntry]

      const [updated] = tx
        .update(userProviderTable)
        .set({ apiKeys: updatedKeys })
        .where(eq(userProviderTable.providerId, providerId))
        .returning()
        .all()

      return { provider: rowToRuntimeProvider(updated), added: true }
    })

    if (added) {
      logger.info('Added API key to provider', { providerId })
    } else {
      logger.info('API key already exists, skipping', { providerId })
    }

    return provider
  }

  /**
   * Replace the full API key list via the dedicated API-key resource.
   */
  replaceApiKeys(providerId: string, apiKeys: ApiKeyEntry[]): Provider {
    assertManagedCherryAiProviderMutationAllowed(providerId, `replace API keys for provider ${providerId}`)

    const normalizedApiKeys = normalizeApiKeyEntries(apiKeys)
    const db = application.get('DbService').getDb()
    const provider = db.transaction((tx) => {
      const [row] = tx
        .update(userProviderTable)
        .set({ apiKeys: normalizedApiKeys })
        .where(eq(userProviderTable.providerId, providerId))
        .returning()
        .all()

      if (!row) {
        throw DataApiErrorFactory.notFound('Provider', providerId)
      }

      return rowToRuntimeProvider(row)
    })

    logger.info('Replaced provider API keys', { providerId, count: normalizedApiKeys.length })

    return provider
  }

  /**
   * Update a single API key entry by key ID.
   */
  updateApiKey(
    providerId: string,
    keyId: string,
    updates: {
      key?: string
      label?: string
      isEnabled?: boolean
    }
  ): Provider {
    assertManagedCherryAiProviderMutationAllowed(providerId, `update API key for provider ${providerId}`)

    const db = application.get('DbService').getDb()
    const provider = db.transaction((tx) => {
      const [row] = tx
        .select()
        .from(userProviderTable)
        .where(eq(userProviderTable.providerId, providerId))
        .limit(1)
        .all()

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

      const [updated] = tx
        .update(userProviderTable)
        .set({ apiKeys: updatedKeys })
        .where(eq(userProviderTable.providerId, providerId))
        .returning()
        .all()

      return rowToRuntimeProvider(updated)
    })

    logger.info('Updated API key', { providerId, keyId, changes: Object.keys(updates) })

    return provider
  }

  /**
   * Delete an API key by key ID and return updated provider.
   */
  deleteApiKey(providerId: string, keyId: string): Provider {
    assertManagedCherryAiProviderMutationAllowed(providerId, `delete API key from provider ${providerId}`)

    const db = application.get('DbService').getDb()
    const provider = db.transaction((tx) => {
      const [row] = tx
        .select()
        .from(userProviderTable)
        .where(eq(userProviderTable.providerId, providerId))
        .limit(1)
        .all()

      if (!row) {
        throw DataApiErrorFactory.notFound('Provider', providerId)
      }

      const existingKeys = row.apiKeys ?? []
      const updatedKeys = existingKeys.filter((entry) => entry.id !== keyId)

      if (updatedKeys.length === existingKeys.length) {
        throw DataApiErrorFactory.notFound('API key', keyId)
      }

      const [updated] = tx
        .update(userProviderTable)
        .set({ apiKeys: updatedKeys })
        .where(eq(userProviderTable.providerId, providerId))
        .returning()
        .all()

      return rowToRuntimeProvider(updated)
    })

    logger.info('Deleted API key from provider', { providerId, keyId })

    return provider
  }

  /**
   * Delete a provider. Canonical preset providers (where providerId === presetProviderId)
   * cannot be deleted. User-created providers that inherit from a preset can be deleted.
   */
  delete(providerId: string): void {
    const db = application.get('DbService').getDb()

    db.transaction((tx) => {
      const [provider] = tx
        .select({ presetProviderId: userProviderTable.presetProviderId })
        .from(userProviderTable)
        .where(eq(userProviderTable.providerId, providerId))
        .limit(1)
        .all()

      if (!provider) {
        throw DataApiErrorFactory.notFound('Provider', providerId)
      }

      // Block deletion of canonical preset rows. `presetProviderId === providerId`
      // covers presets that group under themselves; the registry check also
      // covers presets that group under a different preset (e.g. zai → zhipu,
      // minimax-global → minimax) whose presetProviderId no longer equals their id.
      const providerRegistryService = getDataService('ProviderRegistryService')
      if (
        (provider.presetProviderId && provider.presetProviderId === providerId) ||
        providerRegistryService.isRegistryProvider(providerId)
      ) {
        throw DataApiErrorFactory.invalidOperation(`Cannot delete preset provider '${providerId}'`)
      }

      const models = tx
        .select({ id: userModelTable.id })
        .from(userModelTable)
        .where(eq(userModelTable.providerId, providerId))
        .all()

      pinService.purgeForEntitiesTx(
        tx,
        'model',
        models.map((model) => model.id)
      )

      const deleted = tx
        .delete(userProviderTable)
        .where(eq(userProviderTable.providerId, providerId))
        .returning({ providerId: userProviderTable.providerId })
        .all()

      if (deleted.length === 0) {
        throw DataApiErrorFactory.notFound('Provider', providerId)
      }
    })

    logger.info('Deleted provider', { providerId })
  }

  move(providerId: string, anchor: OrderRequest): void {
    assertManagedCherryAiProviderMutationAllowed(providerId, `move provider ${providerId}`)

    const db = application.get('DbService').getDb()

    try {
      db.transaction((tx) => {
        applyMoves(tx, userProviderTable, [{ id: providerId, anchor }], {
          pkColumn: userProviderTable.providerId
        })
      })
    } catch (error) {
      this.rethrowOrderError(error)
    }
    logger.info('Moved provider', { providerId, anchor })
  }

  reorder(moves: OrderBatchRequest['moves']): void {
    for (const move of moves) {
      assertManagedCherryAiProviderMutationAllowed(move.id, `move provider ${move.id}`)
    }

    const db = application.get('DbService').getDb()

    try {
      db.transaction((tx) => {
        applyMoves(tx, userProviderTable, moves, {
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

registerDataService('ProviderService', providerService)
