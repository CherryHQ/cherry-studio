/**
 * Provider Service - handles provider CRUD operations
 *
 * Provides business logic for:
 * - Provider CRUD operations
 * - Row to Provider conversion
 */

import { application } from '@application'
import { providerLogoFileRefTable } from '@data/db/schemas/fileRelations'
import { userModelTable } from '@data/db/schemas/userModel'
import type { InsertUserProviderRow, UserProviderRow } from '@data/db/schemas/userProvider'
import { type StoredEndpointConfigOverride, userProviderTable } from '@data/db/schemas/userProvider'
import { type SqliteErrorHandlers, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbType } from '@data/db/types'
import { getDataService, registerDataService } from '@data/services/dataServiceRegistry'
import { pinService } from '@data/services/PinService'
import { applyMoves, insertManyWithOrderKey, insertWithOrderKey } from '@data/services/utils/orderKey'
import {
  clearSingleFileRefTx,
  getSingleFileRefId,
  type LogoBindInput,
  reconcileLogoSlotTx
} from '@data/services/utils/singleFileRef'
import { loggerService } from '@logger'
import { getAppEdition } from '@main/utils/appEdition'
import { DataApiError, DataApiErrorFactory, ErrorCode } from '@shared/data/api/errors'
import type { OrderBatchRequest, OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateProviderDto, ListProvidersQuery, UpdateProviderDto } from '@shared/data/api/schemas/providers'
import { isManagedCherryAiProviderId } from '@shared/data/presets/cherryai'
import type { EndpointType } from '@shared/data/types/model'
import type {
  ApiKeyEntry,
  AuthConfig,
  AuthType,
  EndpointConfigOverride,
  Provider,
  ProviderSettings
} from '@shared/data/types/provider'
import { DEFAULT_PROVIDER_SETTINGS } from '@shared/data/types/provider'
import { APP_EDITIONS } from '@shared/types/appEdition'
import { maskApiKey } from '@shared/utils/api'
import { resolveEndpointDialect } from '@shared/utils/provider'
import { and, asc, eq, type SQLWrapper } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { isRetiredProvider } from '../retiredProviders'

const logger = loggerService.withContext('DataApi:ProviderService')

function applyJsonMergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch

  const result: Record<string, unknown> =
    target !== null && typeof target === 'object' && !Array.isArray(target)
      ? { ...(target as Record<string, unknown>) }
      : {}

  for (const [key, value] of Object.entries(patch)) {
    if (value == null) {
      delete result[key]
    } else {
      result[key] = applyJsonMergePatch(result[key], value)
    }
  }
  return result
}

type NewUserProviderInput = Omit<InsertUserProviderRow, 'orderKey'>
type ProviderIdentity = Pick<UserProviderRow, 'providerId' | 'presetProviderId'>

function isProviderAvailableInCurrentEdition(provider: Pick<Provider, 'availableInEditions'>): boolean {
  const availableInEditions = provider.availableInEditions
  if (!availableInEditions || APP_EDITIONS.every((edition) => availableInEditions.includes(edition))) return true

  return availableInEditions.includes(getAppEdition())
}

function isProviderIdentityAvailable(row: ProviderIdentity): boolean {
  if (isRetiredProvider(row.providerId, row.presetProviderId)) return false

  const metadata = getDataService('ProviderRegistryService').getProviderDisplayMetadata(
    row.providerId,
    row.presetProviderId
  )
  return isProviderAvailableInCurrentEdition(metadata)
}

/**
 * Internal update input. `logo` is NOT part of the PATCH DTO (logo edits go
 * through the `provider.set_logo` IpcApi command); the command orchestrator
 * passes a `LogoBindInput` here after creating the `file_entry`.
 */
export type UpdateProviderInput = UpdateProviderDto & { logo?: LogoBindInput }

/** Safe identity snapshot for the API key selected for one provider request. */
export interface ProviderApiKeySnapshot {
  id: string
  label?: string
  masked: string
}

/**
 * Non-secret result of ProviderService's API-key selection.
 *
 * ProviderService owns stored-key selection only. Provider SDK configuration
 * owns the final serving-credential receipt because a builder may replace this
 * selection with OAuth, IAM, or another provider-level credential.
 */
export type ProviderApiKeySelection =
  | ({ attribution: 'explicit' | 'matched' } & ProviderApiKeySnapshot)
  | { attribution: 'unknown' }

/** The selected API-key value and its safe identity, resolved atomically. */
export interface ResolvedProviderApiKey {
  value: string
  apiKeySelection: ProviderApiKeySelection
}

/**
 * Persisted credential receipts must never retain a raw short key, even
 * though the transient display helper intentionally leaves it recognizable.
 */
function maskApiKeyForSnapshot(key: string): string {
  const masked = maskApiKey(key)
  return masked === key ? '****' : masked
}

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

function assertProviderAvailable<T extends ProviderIdentity>(
  row: T | null | undefined,
  providerId: string
): asserts row is T {
  if (!row || !isProviderIdentityAvailable(row)) {
    throw DataApiErrorFactory.notFound('Provider', providerId)
  }
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

function toResolvedProviderApiKey(
  value: string,
  attribution: 'explicit' | 'matched',
  entry: ApiKeyEntry
): ResolvedProviderApiKey {
  return {
    value,
    apiKeySelection: {
      attribution,
      id: entry.id,
      ...(entry.label ? { label: entry.label } : {}),
      masked: maskApiKeyForSnapshot(entry.key)
    }
  }
}

function unknownCredential(value: string): ResolvedProviderApiKey {
  return {
    value,
    apiKeySelection: { attribution: 'unknown' }
  }
}

/**
 * Project write-DTO endpoint configs down to the persisted override shape.
 * Registry-owned fields never reach the row: `adapterFamily` survives only for
 * custom (preset-less) providers, where it is a legacy relay routing hint
 * (new-api/gateway) that endpoint-type inference cannot reproduce. Everything
 * else resolves from the registry at read time (#17096).
 */
function projectEndpointConfigOverrides(
  configs: Partial<Record<EndpointType, EndpointConfigOverride>> | null | undefined,
  providerId: string,
  presetProviderId: string | null,
  storedConfigs?: Partial<Record<EndpointType, StoredEndpointConfigOverride>> | null
): Partial<Record<EndpointType, StoredEndpointConfigOverride>> | null {
  if (!configs || Object.keys(configs).length === 0) return null

  // Registry baseline for delta reduction. Renderer PATCHes echo the merged
  // runtime snapshot, so without this every settings edit would re-freeze
  // registry baseUrls into the row and defeat the delta.
  const presetConfigs = getDataService('ProviderRegistryService').getProviderPreset(
    providerId,
    ['endpointConfigs'],
    presetProviderId
  ).endpointConfigs

  const result: Partial<Record<EndpointType, StoredEndpointConfigOverride>> = {}
  for (const [key, config] of Object.entries(configs)) {
    if (!config) continue
    const ep = key as EndpointType
    const presetConfig = presetConfigs?.[ep]
    const override: StoredEndpointConfigOverride = {}
    if (config.baseUrl !== undefined && config.baseUrl !== presetConfig?.baseUrl) override.baseUrl = config.baseUrl
    // Same delta rule per dialect key: a value equal to the registry's is not an override.
    const baselineDialect = resolveEndpointDialect({ endpointConfigs: presetConfigs ?? undefined }, ep)
    const dialect = Object.fromEntries(
      Object.entries(config.dialect ?? {}).filter(
        ([flag, value]) => value !== undefined && value !== baselineDialect[flag as keyof typeof baselineDialect]
      )
    )
    if (Object.keys(dialect).length > 0) override.dialect = dialect
    if (presetProviderId === null && storedConfigs?.[ep]?.adapterFamily !== undefined) {
      override.adapterFamily = storedConfigs[ep].adapterFamily
    }
    // Drop entries fully covered by the registry; keep empty entries for
    // endpoints the registry doesn't declare — key presence marks a
    // user-configured endpoint and feeds the read-time key union.
    if (Object.keys(override).length === 0 && presetConfig) continue
    result[ep] = override
  }
  return Object.keys(result).length > 0 ? result : null
}

/**
 * Convert database row to Provider entity
 */
function rowToRuntimeProvider(row: UserProviderRow): Provider {
  const providerRegistryService = getDataService('ProviderRegistryService')
  const presetMetadata = providerRegistryService.getProviderDisplayMetadata(row.providerId, row.presetProviderId)

  // Process API keys (strip actual key values for security)
  // oxlint-disable-next-line no-unused-vars
  const apiKeys = (row.apiKeys ?? []).map(({ key: _key, ...rest }) => rest)

  // Determine auth type
  let authType: AuthType = 'api-key'
  if (row.authConfig?.type) {
    authType = row.authConfig.type
  }

  // Merge settings
  const settings: ProviderSettings = {
    ...DEFAULT_PROVIDER_SETTINGS,
    ...(row.providerSettings as Partial<ProviderSettings> | null)
  }

  // An uploaded logo's file id lives in the ref table (single source of truth);
  // resolve it main-side so the renderer never reconstructs a disk path. Empty
  // slot → no lookup. A present id is never dangling (the ref row's
  // `file_entry_id` FK is `on delete cascade`), so letting `getUrl` throw
  // surfaces a real invariant break instead of swallowing it.
  const logoFileId = getSingleFileRefId(providerLogoFileRefTable, row.providerId)

  return {
    id: row.providerId,
    presetProviderId: row.presetProviderId ?? undefined,
    name: row.name,
    // Preset icon key stays on `logo`, an uploaded one on `logoSrc` — mutually exclusive.
    logo: row.logoKey ?? undefined,
    logoSrc: logoFileId ? application.get('FileManager').getUrl(logoFileId) : undefined,
    description: presetMetadata.description,
    websites: presetMetadata.websites,
    availableInEditions: presetMetadata.availableInEditions,
    // Registry-owned connection facts (adapterFamily, modelsApiUrls, the
    // endpoint-type key set) resolve from the CURRENT registry at read time
    // (#17096 — the seeder is insert-only, so the row alone goes stale);
    // the row contributes user-owned baseUrl and dialect overrides. Legacy
    // registry-only fields such as `reasoningFormatType` are stripped first.
    endpointConfigs:
      providerRegistryService.mergeEndpointConfigs(row.endpointConfigs, row.providerId, row.presetProviderId) ??
      undefined,
    defaultChatEndpoint: row.defaultChatEndpoint ?? presetMetadata.defaultChatEndpoint,
    modelListSource: presetMetadata.modelListSource,
    authMethods: presetMetadata.authMethods,
    authOptional: presetMetadata.authOptional,
    serverTools: presetMetadata.serverTools ?? [],
    ...(presetMetadata.reportedCostCurrency ? { reportedCostCurrency: presetMetadata.reportedCostCurrency } : {}),
    reportsActualCost: presetMetadata.reportsActualCost ?? false,
    fastMode: presetMetadata.fastMode,
    apiKeys,
    authType,
    settings,
    isEnabled: row.isEnabled
  }
}

/** Internal cache key holding the rotation pointer (id of the key last handed out). */
function rotationCacheKey(providerId: string): string {
  return `settings.provider.${providerId}.last_used_key_id`
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

    const rows =
      conditions.length > 0
        ? db
            .select()
            .from(userProviderTable)
            .where(and(...conditions))
            .orderBy(asc(userProviderTable.orderKey))
            .all()
        : db.select().from(userProviderTable).orderBy(asc(userProviderTable.orderKey)).all()

    return rows.filter(isProviderIdentityAvailable).map(rowToRuntimeProvider)
  }

  /** Return provider IDs available to runtime callers in this application edition. */
  listAvailableProviderIds(): Set<string> {
    const rows = application
      .get('DbService')
      .getDb()
      .select({
        providerId: userProviderTable.providerId,
        presetProviderId: userProviderTable.presetProviderId
      })
      .from(userProviderTable)
      .all()

    return new Set(rows.filter(isProviderIdentityAvailable).map((row) => row.providerId))
  }

  /** Check whether a persisted provider is available to runtime callers in this application edition. */
  isAvailableByProviderId(providerId: string): boolean {
    const [row] = application
      .get('DbService')
      .getDb()
      .select({
        providerId: userProviderTable.providerId,
        presetProviderId: userProviderTable.presetProviderId
      })
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, providerId))
      .limit(1)
      .all()

    return row !== undefined && isProviderIdentityAvailable(row)
  }

  /**
   * Get a provider by its provider ID
   */
  getByProviderId(providerId: string): Provider {
    const db = application.get('DbService').getDb()
    const [row] = db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId)).limit(1).all()

    assertProviderAvailable(row, providerId)

    return rowToRuntimeProvider(row)
  }

  /**
   * Create a new provider
   */
  create(dto: CreateProviderDto): Provider {
    if (isRetiredProvider(dto.providerId, dto.presetProviderId)) {
      throw DataApiErrorFactory.invalidOperation(`create provider ${dto.providerId}`, 'provider is retired')
    }
    assertManagedCherryAiProviderMutationAllowed(dto.providerId, `create provider ${dto.providerId}`)

    const endpointConfigs = projectEndpointConfigOverrides(
      dto.endpointConfigs,
      dto.providerId,
      dto.presetProviderId ?? null
    )
    const presetMetadata = getDataService('ProviderRegistryService').getProviderDisplayMetadata(
      dto.providerId,
      dto.presetProviderId ?? null
    )
    if (!isProviderAvailableInCurrentEdition(presetMetadata)) {
      throw DataApiErrorFactory.invalidOperation(
        `create provider ${dto.providerId}`,
        'provider is unavailable in the current application edition'
      )
    }
    const defaultChatEndpoint =
      dto.defaultChatEndpoint !== presetMetadata.defaultChatEndpoint ? (dto.defaultChatEndpoint ?? null) : null

    const row = withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          const logoCols = reconcileLogoSlotTx(tx, providerLogoFileRefTable, dto.providerId, dto.logo) ?? {
            logoKey: null
          }
          const values: NewUserProviderInput = {
            providerId: dto.providerId,
            presetProviderId: dto.presetProviderId ?? null,
            name: dto.name,
            logoKey: logoCols.logoKey,
            endpointConfigs,
            defaultChatEndpoint,
            apiKeys: dto.apiKeys ?? [],
            authConfig: dto.authConfig ?? null,
            providerSettings: dto.providerSettings ?? null,
            isEnabled: false
          }
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
   * Update an existing provider. A false-to-true enabled transition moves the
   * provider to the first position in the same transaction; redundant enabled
   * writes preserve the user's current order.
   */
  update(providerId: string, dto: UpdateProviderInput): Provider {
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
        .select({
          providerId: userProviderTable.providerId,
          providerSettings: userProviderTable.providerSettings,
          endpointConfigs: userProviderTable.endpointConfigs,
          isEnabled: userProviderTable.isEnabled,
          presetProviderId: userProviderTable.presetProviderId
        })
        .from(userProviderTable)
        .where(eq(userProviderTable.providerId, providerId))
        .limit(1)
        .all()

      assertProviderAvailable(current, providerId)

      const updates: Partial<InsertUserProviderRow> = {}

      if (dto.name !== undefined) updates.name = dto.name
      // DB-only logo reconcile: replace the slot's file_ref + set the logo key.
      const logoCols = reconcileLogoSlotTx(tx, providerLogoFileRefTable, providerId, dto.logo)
      if (logoCols) {
        updates.logoKey = logoCols.logoKey
      }
      // PATCH replaces endpointConfigs wholesale; only the user-owned override
      // shape is persisted — registry-owned fields resolve at read time.
      if (dto.endpointConfigs !== undefined) {
        updates.endpointConfigs = projectEndpointConfigOverrides(
          dto.endpointConfigs,
          providerId,
          current.presetProviderId,
          current.endpointConfigs
        )
      }
      if (dto.authConfig !== undefined) updates.authConfig = dto.authConfig
      const presetMetadata =
        dto.defaultChatEndpoint !== undefined
          ? getDataService('ProviderRegistryService').getProviderDisplayMetadata(providerId, current.presetProviderId)
          : undefined
      // A renderer may echo the merged runtime value while editing an unrelated
      // field. Drop a baseline-equal endpoint instead of freezing that registry
      // default into the row.
      if (dto.defaultChatEndpoint !== undefined) {
        updates.defaultChatEndpoint =
          dto.defaultChatEndpoint === presetMetadata?.defaultChatEndpoint ? null : dto.defaultChatEndpoint
      }
      if (dto.providerSettings !== undefined) {
        updates.providerSettings = applyJsonMergePatch(
          current.providerSettings,
          dto.providerSettings
        ) as Partial<ProviderSettings>
      }

      if (dto.isEnabled === true && !current.isEnabled) {
        try {
          applyMoves(tx, userProviderTable, [{ id: providerId, anchor: { position: 'first' } }], {
            pkColumn: userProviderTable.providerId
          })
        } catch (error) {
          this.rethrowOrderError(error)
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
   * Select an API-key candidate and capture its identity atomically. The
   * provider config builder decides whether this value or provider-level auth
   * actually serves the request. An explicit override is never rotated, but is
   * matched back to a stored key when possible.
   */
  resolveApiKey(providerId: string, override?: string): ResolvedProviderApiKey {
    const db = application.get('DbService').getDb()
    const [row] = db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId)).limit(1).all()

    assertProviderAvailable(row, providerId)

    const allKeys = row.apiKeys ?? []
    if (override !== undefined) {
      const matched = allKeys.find((entry) => entry.key === override)
      return matched ? toResolvedProviderApiKey(override, 'matched', matched) : unknownCredential(override)
    }

    const enabledKeys = allKeys.filter((k) => k.isEnabled)

    if (enabledKeys.length === 0) {
      return unknownCredential('')
    }

    if (enabledKeys.length === 1) {
      return toResolvedProviderApiKey(enabledKeys[0].key, 'explicit', enabledKeys[0])
    }

    // Round-robin using CacheService
    const cache = application.get('CacheService')
    const cacheKey = rotationCacheKey(providerId)
    const lastUsedKeyId = cache.get<string>(cacheKey)

    if (!lastUsedKeyId) {
      cache.set(cacheKey, enabledKeys[0].id)
      return toResolvedProviderApiKey(enabledKeys[0].key, 'explicit', enabledKeys[0])
    }

    const currentIndex = enabledKeys.findIndex((k) => k.id === lastUsedKeyId)
    const nextIndex = (currentIndex + 1) % enabledKeys.length
    const nextKey = enabledKeys[nextIndex]
    cache.set(cacheKey, nextKey.id)

    return toResolvedProviderApiKey(nextKey.key, 'explicit', nextKey)
  }

  /**
   * Compatibility wrapper for consumers that only need the credential value.
   * Billing-aware callers should use {@link resolveApiKey}.
   */
  getRotatedApiKey(providerId: string): string {
    return this.resolveApiKey(providerId).value
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

    assertProviderAvailable(row, providerId)

    const apiKeys = row.apiKeys ?? []
    return options.enabled ? apiKeys.filter((k) => k.isEnabled) : apiKeys
  }

  /**
   * Get full auth config (includes sensitive credentials).
   */
  getAuthConfig(providerId: string): AuthConfig | null {
    const db = application.get('DbService').getDb()
    const [row] = db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId)).limit(1).all()

    assertProviderAvailable(row, providerId)

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

      assertProviderAvailable(row, providerId)

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

    const db = application.get('DbService').getDb()
    const provider = db.transaction((tx) => {
      const [current] = tx
        .select({
          providerId: userProviderTable.providerId,
          presetProviderId: userProviderTable.presetProviderId
        })
        .from(userProviderTable)
        .where(eq(userProviderTable.providerId, providerId))
        .limit(1)
        .all()

      assertProviderAvailable(current, providerId)

      const normalizedApiKeys = normalizeApiKeyEntries(apiKeys)
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

    logger.info('Replaced provider API keys', { providerId, count: apiKeys.length })

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

      assertProviderAvailable(row, providerId)

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

      assertProviderAvailable(row, providerId)

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
    const deletedModelCount = application.get('DbService').withWriteTx((tx) => {
      const [provider] = tx
        .select({
          providerId: userProviderTable.providerId,
          presetProviderId: userProviderTable.presetProviderId
        })
        .from(userProviderTable)
        .where(eq(userProviderTable.providerId, providerId))
        .limit(1)
        .all()

      assertProviderAvailable(provider, providerId)

      // Block deletion of canonical preset rows. `presetProviderId === providerId`
      // covers presets that group under themselves; the registry check also
      // covers presets that group under a different preset (e.g. zai → zhipu,
      // minimax-global → minimax) whose presetProviderId no longer equals their id.
      const providerRegistryService = getDataService('ProviderRegistryService')
      if (
        (provider.presetProviderId && provider.presetProviderId === providerId) ||
        (provider.presetProviderId !== null && providerRegistryService.isRegistryProvider(providerId))
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

      // DB-only: drop the logo slot's ref (the file is preserved per the
      // file layer's policy). The FK cascade would also clear it on row delete;
      // the explicit clear keeps the intent local to this flow.
      clearSingleFileRefTx(tx, providerLogoFileRefTable, providerId)

      const deleted = tx
        .delete(userProviderTable)
        .where(eq(userProviderTable.providerId, providerId))
        .returning({ providerId: userProviderTable.providerId })
        .all()

      if (deleted.length === 0) {
        throw DataApiErrorFactory.notFound('Provider', providerId)
      }

      return models.length
    })

    if (deletedModelCount > 0) pinService.notifyPurged()

    logger.info('Deleted provider', { providerId })
  }

  move(providerId: string, anchor: OrderRequest): void {
    assertManagedCherryAiProviderMutationAllowed(providerId, `move provider ${providerId}`)
    this.getByProviderId(providerId)

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
      this.getByProviderId(move.id)
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
