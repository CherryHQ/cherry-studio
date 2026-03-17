/**
 * Unit tests for ProviderService
 *
 * Tests all public methods:
 * - Singleton pattern (getInstance)
 * - list (with and without enabled filter)
 * - getByProviderId (found and not found)
 * - create (creates and returns mapped provider)
 * - update (updates existing, throws when not found)
 * - batchUpsert (upserts multiple, skips empty array)
 * - getRotatedApiKey (no keys, single key, round-robin rotation)
 * - getEnabledApiKeys (returns values, throws when not found)
 * - addApiKey (adds new key, skips duplicate)
 * - delete (deletes existing, throws when not found)
 * - rowToRuntimeProvider mapping (tested indirectly via other methods)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Module-level mocks (hoisted by Vitest) ──────────────────────────────────

vi.mock('@shared/data/api', async () => {
  const actual: any = await vi.importActual('@shared/data/api')
  return {
    ...actual,
    DataApiErrorFactory: {
      ...actual.DataApiErrorFactory,
      notFound: vi.fn((resource: string, id: string) => {
        const err = new Error(`${resource} not found: ${id}`)
        ;(err as any).code = 'NOT_FOUND'
        ;(err as any).resource = resource
        ;(err as any).id = id
        return err
      })
    }
  }
})

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { EndpointType } from '@cherrystudio/provider-catalog'
import { CacheService } from '@data/CacheService'
import { dbService } from '@data/db/DbService'
import type { NewUserProvider, UserProvider } from '@data/db/schemas/userProvider'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateProviderDto, UpdateProviderDto } from '@shared/data/api/schemas/providers'
import { DEFAULT_API_FEATURES, DEFAULT_PROVIDER_SETTINGS } from '@shared/data/types/provider'

import { ProviderService } from '../ProviderService'

// ─── Helpers & fixtures ───────────────────────────────────────────────────────

/**
 * Minimal UserProvider DB row with sensible defaults.
 * All nullable JSON columns are set to null by default so tests can opt-in.
 */
function makeDbRow(overrides: Partial<UserProvider> = {}): UserProvider {
  return {
    id: 'row-uuid-1',
    providerId: 'test-provider',
    presetProviderId: null,
    name: 'Test Provider',
    baseUrls: null,
    modelsApiUrls: null,
    defaultChatEndpoint: null,
    apiKeys: [],
    authConfig: null,
    apiFeatures: null,
    providerSettings: null,
    reasoningFormatType: null,
    websites: null,
    isEnabled: true,
    sortOrder: 0,
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    ...overrides
  }
}

/**
 * Minimal CreateProviderDto.
 */
function makeCreateDto(overrides: Partial<CreateProviderDto> = {}): CreateProviderDto {
  return {
    providerId: 'new-provider',
    name: 'New Provider',
    ...overrides
  }
}

/**
 * Build a fluent mock DB query builder.
 *
 * Each method returns `this` for chaining. The terminal operation is the
 * last awaited call, and its resolved value is set via `resolveWith`.
 *
 * The mock exposes each chainable method as a `vi.fn()` so call assertions
 * work naturally with `expect(mockDb.select).toHaveBeenCalled()`.
 */
function buildMockDb(resolveWith: unknown = [], opts?: { returningWith?: unknown }) {
  // `.returning()` resolves with `returningWith` if provided, otherwise same as `resolveWith`
  const returningValue = opts?.returningWith !== undefined ? opts.returningWith : resolveWith
  const terminal = vi.fn().mockResolvedValue(returningValue)

  const chain: Record<string, ReturnType<typeof vi.fn>> = {}

  const makeChainable = (name: string) => {
    chain[name] = vi.fn().mockReturnValue(chainProxy)
    return chain[name]
  }

  const chainProxy: Record<string, unknown> = {}

  // Chainable query builder methods
  const chainableMethods = [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'set',
    'values',
    'onConflictDoUpdate',
    'insert',
    'update',
    'delete'
  ] as const

  for (const method of chainableMethods) {
    makeChainable(method)
  }

  // Terminal `.returning()` — resolves with the fixture value
  chain.returning = terminal

  // `select()` starts a chain that ends with `.from()...` which can be awaited.
  // We also need the root select chain to be directly awaitable for cases like
  // `db.select().from(...).where(...).orderBy(...)` (no .returning()).
  // Patch chainProxy so it is also thenable for those paths.
  ;(chainProxy as any).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    Promise.resolve(resolveWith).then(resolve, reject)
  }

  // Assign all chain methods to the proxy
  for (const [key, fn] of Object.entries(chain)) {
    chainProxy[key] = fn
  }

  return {
    ...chainProxy,
    _terminal: terminal,
    _chain: chain
  } as any
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function resetSingleton() {
  ;(ProviderService as any).instance = undefined
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('ProviderService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSingleton()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── Singleton ─────────────────────────────────────────────────────────────

  describe('getInstance', () => {
    it('returns the same instance on repeated calls', () => {
      const a = ProviderService.getInstance()
      const b = ProviderService.getInstance()
      expect(a).toBe(b)
    })

    it('returns a ProviderService instance', () => {
      const svc = ProviderService.getInstance()
      expect(svc).toBeInstanceOf(ProviderService)
    })
  })

  // ─── list ──────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns all providers when no enabled filter is provided', async () => {
      const rows = [makeDbRow({ providerId: 'p1', name: 'P1' }), makeDbRow({ providerId: 'p2', name: 'P2' })]
      const mockDb = buildMockDb(rows)
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.list({})

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('p1')
      expect(result[1].id).toBe('p2')
    })

    it('filters by enabled=true when provided', async () => {
      const enabledRow = makeDbRow({ providerId: 'enabled-provider', isEnabled: true })
      const mockDb = buildMockDb([enabledRow])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.list({ enabled: true })

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('enabled-provider')
      expect(result[0].isEnabled).toBe(true)
    })

    it('filters by enabled=false when provided', async () => {
      const disabledRow = makeDbRow({ providerId: 'disabled-provider', isEnabled: false })
      const mockDb = buildMockDb([disabledRow])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.list({ enabled: false })

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('disabled-provider')
      expect(result[0].isEnabled).toBe(false)
    })

    it('returns an empty array when no providers exist', async () => {
      const mockDb = buildMockDb([])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.list({})

      expect(result).toEqual([])
    })

    it('maps each row through rowToRuntimeProvider', async () => {
      const row = makeDbRow({
        providerId: 'mapped-provider',
        name: 'Mapped',
        presetProviderId: 'openai',
        baseUrls: { [EndpointType.OPENAI_CHAT_COMPLETIONS]: 'https://api.example.com/v1' } as any,
        isEnabled: false
      })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const [provider] = await svc.list({})

      expect(provider.id).toBe('mapped-provider')
      expect(provider.name).toBe('Mapped')
      expect(provider.presetProviderId).toBe('openai')
      expect(provider.isEnabled).toBe(false)
    })
  })

  // ─── getByProviderId ───────────────────────────────────────────────────────

  describe('getByProviderId', () => {
    it('returns the matching provider when found', async () => {
      const row = makeDbRow({ providerId: 'openai', name: 'OpenAI' })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const provider = await svc.getByProviderId('openai')

      expect(provider.id).toBe('openai')
      expect(provider.name).toBe('OpenAI')
    })

    it('throws a not-found error when the provider does not exist', async () => {
      const mockDb = buildMockDb([])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      await expect(svc.getByProviderId('nonexistent')).rejects.toThrow()
      expect(DataApiErrorFactory.notFound).toHaveBeenCalledWith('Provider', 'nonexistent')
    })

    it('strips the key field from apiKeys in the returned Provider', async () => {
      const row = makeDbRow({
        providerId: 'secure-provider',
        apiKeys: [{ id: 'key-1', key: 'sk-secret', isEnabled: true, createdAt: 1000 }]
      })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const provider = await svc.getByProviderId('secure-provider')

      expect(provider.apiKeys).toHaveLength(1)
      expect(provider.apiKeys[0]).not.toHaveProperty('key')
      expect(provider.apiKeys[0].id).toBe('key-1')
    })
  })

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('inserts a new provider and returns the mapped row', async () => {
      const returnedRow = makeDbRow({
        providerId: 'new-provider',
        name: 'New Provider'
      })
      const mockDb = buildMockDb([returnedRow])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const dto = makeCreateDto()
      const result = await svc.create(dto)

      expect(result.id).toBe('new-provider')
      expect(result.name).toBe('New Provider')
    })

    it('passes dto fields through to the insert values', async () => {
      const returnedRow = makeDbRow({
        providerId: 'custom',
        presetProviderId: 'openai',
        name: 'Custom OpenAI',
        baseUrls: { [EndpointType.OPENAI_CHAT_COMPLETIONS]: 'https://custom.example.com' } as any
      })
      const mockDb = buildMockDb([returnedRow])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.create({
        providerId: 'custom',
        presetProviderId: 'openai',
        name: 'Custom OpenAI',
        baseUrls: { [EndpointType.OPENAI_CHAT_COMPLETIONS]: 'https://custom.example.com' }
      })

      expect(result.id).toBe('custom')
      expect(result.presetProviderId).toBe('openai')
    })

    it('defaults apiKeys to empty array when not provided in dto', async () => {
      const returnedRow = makeDbRow({ providerId: 'no-keys-provider', apiKeys: [] })
      const mockDb = buildMockDb([returnedRow])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.create(makeCreateDto({ providerId: 'no-keys-provider' }))

      expect(result.apiKeys).toEqual([])
    })

    it('sets authType from authConfig.type when provided', async () => {
      const returnedRow = makeDbRow({
        providerId: 'iam-provider',
        authConfig: { type: 'iam-aws', region: 'us-east-1' }
      })
      const mockDb = buildMockDb([returnedRow])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.create(makeCreateDto({ providerId: 'iam-provider' }))

      expect(result.authType).toBe('iam-aws')
    })

    it('passes all optional DTO fields to insert values', async () => {
      const returnedRow = makeDbRow({
        providerId: 'full-create',
        baseUrls: { [EndpointType.OPENAI_CHAT_COMPLETIONS]: 'https://api.example.com' } as any,
        modelsApiUrls: { list: 'https://api.example.com/models' } as any,
        defaultChatEndpoint: '/v1/chat' as any,
        apiKeys: [{ id: 'k1', key: 'sk-test', isEnabled: true, createdAt: 1000 }],
        authConfig: { type: 'oauth', clientId: 'client-123' },
        apiFeatures: { developerRole: true } as any,
        providerSettings: { timeout: 5000 } as any
      })
      const mockDb = buildMockDb([returnedRow])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.create({
        providerId: 'full-create',
        name: 'Full Provider',
        baseUrls: { [EndpointType.OPENAI_CHAT_COMPLETIONS]: 'https://api.example.com' },
        modelsApiUrls: { list: 'https://api.example.com/models' },
        defaultChatEndpoint: '/v1/chat' as any,
        apiKeys: [{ id: 'k1', key: 'sk-test', isEnabled: true, createdAt: 1000 }],
        authConfig: { type: 'oauth', clientId: 'client-123' },
        apiFeatures: { developerRole: true } as any,
        providerSettings: { timeout: 5000 } as any
      })

      expect(result.id).toBe('full-create')
      expect(result.baseUrls).toEqual({ [EndpointType.OPENAI_CHAT_COMPLETIONS]: 'https://api.example.com' })
      expect(result.authType).toBe('oauth')
    })
  })

  // ─── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('fetches the existing provider, applies changes, and returns updated row', async () => {
      const existingRow = makeDbRow({ providerId: 'update-me', name: 'Old Name' })
      const updatedRow = makeDbRow({ providerId: 'update-me', name: 'New Name' })

      // update() calls getDb() first (line 141), then getByProviderId calls getDb() again (line 100)
      // 1st getDb call → used for the actual UPDATE ... RETURNING
      // 2nd getDb call → used inside getByProviderId for SELECT existence check
      vi.mocked(dbService.getDb)
        .mockReturnValueOnce(buildMockDb([updatedRow]) as any) // for update().returning()
        .mockReturnValueOnce(buildMockDb([existingRow]) as any) // for getByProviderId

      const svc = ProviderService.getInstance()
      const dto: UpdateProviderDto = { name: 'New Name' }
      const result = await svc.update('update-me', dto)

      expect(result.name).toBe('New Name')
    })

    it('throws not-found when the provider does not exist', async () => {
      // getByProviderId returns empty → throws
      const mockDb = buildMockDb([])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      await expect(svc.update('ghost', { name: 'X' })).rejects.toThrow()
      expect(DataApiErrorFactory.notFound).toHaveBeenCalledWith('Provider', 'ghost')
    })

    it('only includes defined dto fields in the update set', async () => {
      const existingRow = makeDbRow({ providerId: 'partial-update', isEnabled: true })
      const afterUpdateRow = makeDbRow({ providerId: 'partial-update', isEnabled: false })

      vi.mocked(dbService.getDb)
        .mockReturnValueOnce(buildMockDb([afterUpdateRow]) as any)
        .mockReturnValueOnce(buildMockDb([existingRow]) as any)

      const svc = ProviderService.getInstance()
      const result = await svc.update('partial-update', { isEnabled: false })

      expect(result.isEnabled).toBe(false)
    })

    it('updates sortOrder when provided', async () => {
      const existingRow = makeDbRow({ providerId: 'ordered', sortOrder: 0 })
      const afterUpdateRow = makeDbRow({ providerId: 'ordered', sortOrder: 5 })

      vi.mocked(dbService.getDb)
        .mockReturnValueOnce(buildMockDb([existingRow]) as any)
        .mockReturnValueOnce(buildMockDb([afterUpdateRow]) as any)

      const svc = ProviderService.getInstance()
      const result = await svc.update('ordered', { sortOrder: 5 })

      expect(result).toBeDefined()
    })

    it('includes all optional DTO fields in the update set', async () => {
      const existingRow = makeDbRow({ providerId: 'full-update' })
      const afterUpdateRow = makeDbRow({
        providerId: 'full-update',
        baseUrls: { [EndpointType.OPENAI_CHAT_COMPLETIONS]: 'https://new.api.com' } as any,
        modelsApiUrls: { list: 'https://new.api.com/models' } as any,
        defaultChatEndpoint: '/v2/chat' as any,
        apiKeys: [{ id: 'k1', key: 'sk-new', isEnabled: true, createdAt: 1000 }],
        authConfig: { type: 'oauth' } as any,
        apiFeatures: { developerRole: true } as any,
        providerSettings: { timeout: 10000 } as any
      })

      vi.mocked(dbService.getDb)
        .mockReturnValueOnce(buildMockDb([afterUpdateRow]) as any)
        .mockReturnValueOnce(buildMockDb([existingRow]) as any)

      const svc = ProviderService.getInstance()
      const result = await svc.update('full-update', {
        baseUrls: { [EndpointType.OPENAI_CHAT_COMPLETIONS]: 'https://new.api.com' },
        modelsApiUrls: { list: 'https://new.api.com/models' },
        defaultChatEndpoint: '/v2/chat' as any,
        apiKeys: [{ id: 'k1', key: 'sk-new', isEnabled: true, createdAt: 1000 }],
        authConfig: { type: 'oauth' } as any,
        apiFeatures: { developerRole: true } as any,
        providerSettings: { timeout: 10000 } as any
      })

      expect(result).toBeDefined()
      expect(result.baseUrls).toEqual({ [EndpointType.OPENAI_CHAT_COMPLETIONS]: 'https://new.api.com' })
      expect(result.authType).toBe('oauth')
    })

    it('handles empty DTO without errors', async () => {
      const existingRow = makeDbRow({ providerId: 'empty-dto' })
      const afterUpdateRow = makeDbRow({ providerId: 'empty-dto' })

      vi.mocked(dbService.getDb)
        .mockReturnValueOnce(buildMockDb([afterUpdateRow]) as any)
        .mockReturnValueOnce(buildMockDb([existingRow]) as any)

      const svc = ProviderService.getInstance()
      const result = await svc.update('empty-dto', {})

      expect(result).toBeDefined()
      expect(result.id).toBe('empty-dto')
    })
  })

  // ─── batchUpsert ───────────────────────────────────────────────────────────

  describe('batchUpsert', () => {
    it('returns immediately without hitting the DB for an empty array', async () => {
      const mockDb = buildMockDb([])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      await svc.batchUpsert([])

      // getDb should not be called at all
      expect(dbService.getDb).not.toHaveBeenCalled()
    })

    it('calls insert with onConflictDoUpdate for each provider', async () => {
      const provider: NewUserProvider = {
        providerId: 'p1',
        name: 'Provider One'
      }

      // batchUpsert uses insert().values().onConflictDoUpdate() — no .returning()
      // so we rely on the chain proxy being thenable
      const mockDb = buildMockDb(undefined)
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      // Should not throw
      await expect(svc.batchUpsert([provider])).resolves.toBeUndefined()
    })

    it('processes multiple providers in the batch', async () => {
      const providers: NewUserProvider[] = [
        { providerId: 'p1', name: 'P1' },
        { providerId: 'p2', name: 'P2' },
        { providerId: 'p3', name: 'P3' }
      ]

      const mockDb = buildMockDb(undefined)
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      await expect(svc.batchUpsert(providers)).resolves.toBeUndefined()
    })

    it('onConflictDoUpdate set-clause includes preset fields and excludes user fields', async () => {
      const provider: NewUserProvider = {
        providerId: 'upsert-check',
        name: 'Upsert Provider',
        presetProviderId: 'openai',
        baseUrls: { [EndpointType.OPENAI_CHAT_COMPLETIONS]: 'https://api.example.com' } as any,
        modelsApiUrls: { list: 'https://api.example.com/models' } as any,
        defaultChatEndpoint: '/v1/chat' as any,
        apiFeatures: { developerRole: true } as any,
        providerSettings: { timeout: 5000 } as any,
        websites: { official: 'https://openai.com' },
        apiKeys: [{ id: 'k1', key: 'sk-test', isEnabled: true, createdAt: 1000 }],
        isEnabled: true,
        sortOrder: 5,
        authConfig: { type: 'oauth' } as any
      }

      const mockDb = buildMockDb(undefined)
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      await svc.batchUpsert([provider])

      // Access the onConflictDoUpdate call to check the set clause
      const onConflictCalls = mockDb._chain.onConflictDoUpdate.mock.calls
      expect(onConflictCalls).toHaveLength(1)
      const [conflictArg] = onConflictCalls[0]
      const { set } = conflictArg as { set: Record<string, unknown> }

      // Preset fields SHOULD be in set
      expect(set).toHaveProperty('presetProviderId')
      expect(set).toHaveProperty('name')
      expect(set).toHaveProperty('baseUrls')
      expect(set).toHaveProperty('modelsApiUrls')
      expect(set).toHaveProperty('defaultChatEndpoint')
      expect(set).toHaveProperty('apiFeatures')
      expect(set).toHaveProperty('providerSettings')
      expect(set).toHaveProperty('websites')

      // User fields should NOT be in set
      expect(set).not.toHaveProperty('apiKeys')
      expect(set).not.toHaveProperty('isEnabled')
      expect(set).not.toHaveProperty('sortOrder')
      expect(set).not.toHaveProperty('authConfig')
    })
  })

  // ─── getRotatedApiKey ──────────────────────────────────────────────────────

  describe('getRotatedApiKey', () => {
    it('throws not-found when the provider does not exist', async () => {
      const mockDb = buildMockDb([])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      await expect(svc.getRotatedApiKey('ghost')).rejects.toThrow()
      expect(DataApiErrorFactory.notFound).toHaveBeenCalledWith('Provider', 'ghost')
    })

    it('returns empty string when provider has no enabled keys', async () => {
      const row = makeDbRow({ providerId: 'keyless', apiKeys: [] })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.getRotatedApiKey('keyless')

      expect(result).toBe('')
    })

    it('returns empty string when all keys are disabled', async () => {
      const row = makeDbRow({
        providerId: 'all-disabled',
        apiKeys: [
          { id: 'k1', key: 'sk-111', isEnabled: false, createdAt: 1000 },
          { id: 'k2', key: 'sk-222', isEnabled: false, createdAt: 1001 }
        ]
      })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.getRotatedApiKey('all-disabled')

      expect(result).toBe('')
    })

    it('returns the single key directly (no cache interaction)', async () => {
      const row = makeDbRow({
        providerId: 'single-key',
        apiKeys: [{ id: 'k1', key: 'sk-single', isEnabled: true, createdAt: 1000 }]
      })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.getRotatedApiKey('single-key')

      expect(result).toBe('sk-single')
      // CacheService should NOT be used for single key
      const cache = CacheService.getInstance()
      expect(cache.get).not.toHaveBeenCalled()
    })

    it('returns the first key and stores it in cache when no prior cache entry', async () => {
      const row = makeDbRow({
        providerId: 'multi-key',
        apiKeys: [
          { id: 'k1', key: 'sk-first', isEnabled: true, createdAt: 1000 },
          { id: 'k2', key: 'sk-second', isEnabled: true, createdAt: 1001 }
        ]
      })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      // Ensure cache has no prior entry
      const cache = CacheService.getInstance()
      vi.mocked(cache.get).mockReturnValue(undefined)

      const svc = ProviderService.getInstance()
      const result = await svc.getRotatedApiKey('multi-key')

      expect(result).toBe('sk-first')
      expect(cache.set).toHaveBeenCalledWith('provider:multi-key:last_used_key_id', 'k1')
    })

    it('rotates to the next key (round-robin) using cached last-used key id', async () => {
      const row = makeDbRow({
        providerId: 'rotate-provider',
        apiKeys: [
          { id: 'k1', key: 'sk-first', isEnabled: true, createdAt: 1000 },
          { id: 'k2', key: 'sk-second', isEnabled: true, createdAt: 1001 }
        ]
      })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      // Simulate that k1 was used last
      const cache = CacheService.getInstance()
      vi.mocked(cache.get).mockReturnValue('k1')

      const svc = ProviderService.getInstance()
      const result = await svc.getRotatedApiKey('rotate-provider')

      // Should return k2 (index 1 = (0+1) % 2)
      expect(result).toBe('sk-second')
      expect(cache.set).toHaveBeenCalledWith('provider:rotate-provider:last_used_key_id', 'k2')
    })

    it('wraps around to the first key after the last key is used', async () => {
      const row = makeDbRow({
        providerId: 'wrap-around',
        apiKeys: [
          { id: 'k1', key: 'sk-first', isEnabled: true, createdAt: 1000 },
          { id: 'k2', key: 'sk-second', isEnabled: true, createdAt: 1001 }
        ]
      })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      // Simulate that k2 (last key) was used
      const cache = CacheService.getInstance()
      vi.mocked(cache.get).mockReturnValue('k2')

      const svc = ProviderService.getInstance()
      const result = await svc.getRotatedApiKey('wrap-around')

      // Should wrap to k1 (index 0 = (1+1) % 2)
      expect(result).toBe('sk-first')
      expect(cache.set).toHaveBeenCalledWith('provider:wrap-around:last_used_key_id', 'k1')
    })

    it('skips disabled keys in round-robin rotation', async () => {
      const row = makeDbRow({
        providerId: 'mixed-keys',
        apiKeys: [
          { id: 'k1', key: 'sk-enabled', isEnabled: true, createdAt: 1000 },
          { id: 'k2', key: 'sk-disabled', isEnabled: false, createdAt: 1001 },
          { id: 'k3', key: 'sk-also-enabled', isEnabled: true, createdAt: 1002 }
        ]
      })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      // k1 was last used; k2 is disabled so the next enabled key is k3
      const cache = CacheService.getInstance()
      vi.mocked(cache.get).mockReturnValue('k1')

      const svc = ProviderService.getInstance()
      const result = await svc.getRotatedApiKey('mixed-keys')

      // enabledKeys = [k1, k3]; currentIndex of k1 = 0; nextIndex = 1 → k3
      expect(result).toBe('sk-also-enabled')
    })

    it('uses cache key namespaced by providerId', async () => {
      const row = makeDbRow({
        providerId: 'namespace-check',
        apiKeys: [
          { id: 'k1', key: 'sk-a', isEnabled: true, createdAt: 1000 },
          { id: 'k2', key: 'sk-b', isEnabled: true, createdAt: 1001 }
        ]
      })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const cache = CacheService.getInstance()
      vi.mocked(cache.get).mockReturnValue(undefined)

      const svc = ProviderService.getInstance()
      await svc.getRotatedApiKey('namespace-check')

      expect(cache.get).toHaveBeenCalledWith('provider:namespace-check:last_used_key_id')
    })

    it('returns empty string when apiKeys is null (falls back to empty array)', async () => {
      const row = makeDbRow({ providerId: 'null-keys', apiKeys: null as any })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.getRotatedApiKey('null-keys')

      expect(result).toBe('')
    })

    it('wraps to first key when cached key ID is no longer in enabled list', async () => {
      const row = makeDbRow({
        providerId: 'stale-cache',
        apiKeys: [
          { id: 'k1', key: 'sk-first', isEnabled: true, createdAt: 1000 },
          { id: 'k2', key: 'sk-second', isEnabled: true, createdAt: 1001 }
        ]
      })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      // Cache has a stale key ID that no longer exists
      const cache = CacheService.getInstance()
      vi.mocked(cache.get).mockReturnValue('deleted-key-id')

      const svc = ProviderService.getInstance()
      const result = await svc.getRotatedApiKey('stale-cache')

      // findIndex('deleted-key-id') returns -1, nextIndex = (-1 + 1) % 2 = 0
      expect(result).toBe('sk-first')
      expect(cache.set).toHaveBeenCalledWith('provider:stale-cache:last_used_key_id', 'k1')
    })
  })

  // ─── getEnabledApiKeys ────────────────────────────────────────────────────

  describe('getEnabledApiKeys', () => {
    it('throws not-found when the provider does not exist', async () => {
      const mockDb = buildMockDb([])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      await expect(svc.getEnabledApiKeys('ghost')).rejects.toThrow()
      expect(DataApiErrorFactory.notFound).toHaveBeenCalledWith('Provider', 'ghost')
    })

    it('returns empty array when provider has no keys', async () => {
      const row = makeDbRow({ providerId: 'no-keys', apiKeys: [] })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.getEnabledApiKeys('no-keys')

      expect(result).toEqual([])
    })

    it('returns only the key values of enabled keys', async () => {
      const row = makeDbRow({
        providerId: 'mixed-keys',
        apiKeys: [
          { id: 'k1', key: 'sk-enabled-1', isEnabled: true, createdAt: 1000 },
          { id: 'k2', key: 'sk-disabled', isEnabled: false, createdAt: 1001 },
          { id: 'k3', key: 'sk-enabled-2', isEnabled: true, createdAt: 1002 }
        ]
      })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.getEnabledApiKeys('mixed-keys')

      expect(result).toEqual(['sk-enabled-1', 'sk-enabled-2'])
    })

    it('returns empty array when all keys are disabled', async () => {
      const row = makeDbRow({
        providerId: 'all-disabled',
        apiKeys: [
          { id: 'k1', key: 'sk-1', isEnabled: false, createdAt: 1000 },
          { id: 'k2', key: 'sk-2', isEnabled: false, createdAt: 1001 }
        ]
      })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.getEnabledApiKeys('all-disabled')

      expect(result).toEqual([])
    })

    it('returns empty array when apiKeys is null', async () => {
      const row = makeDbRow({ providerId: 'null-keys', apiKeys: null as any })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.getEnabledApiKeys('null-keys')

      expect(result).toEqual([])
    })
  })

  // ─── addApiKey ────────────────────────────────────────────────────────────

  describe('addApiKey', () => {
    it('throws not-found when the provider does not exist', async () => {
      const mockDb = buildMockDb([])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      await expect(svc.addApiKey('ghost', 'sk-new')).rejects.toThrow()
      expect(DataApiErrorFactory.notFound).toHaveBeenCalledWith('Provider', 'ghost')
    })

    it('returns the existing provider unchanged when the key value already exists', async () => {
      const row = makeDbRow({
        providerId: 'dup-check',
        apiKeys: [{ id: 'existing-id', key: 'sk-duplicate', isEnabled: true, createdAt: 1000 }]
      })
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.addApiKey('dup-check', 'sk-duplicate')

      // Provider is returned as-is (no update performed)
      expect(result.id).toBe('dup-check')
      expect(result.apiKeys).toHaveLength(1)
    })

    it('appends a new key entry and returns the updated provider', async () => {
      const existingRow = makeDbRow({
        providerId: 'add-key',
        apiKeys: [{ id: 'old-id', key: 'sk-old', isEnabled: true, createdAt: 1000 }]
      })
      const updatedRow = makeDbRow({
        providerId: 'add-key',
        apiKeys: [
          { id: 'old-id', key: 'sk-old', isEnabled: true, createdAt: 1000 },
          { id: 'new-id', key: 'sk-new', isEnabled: true, createdAt: 2000 }
        ]
      })

      // addApiKey calls getDb() once; SELECT (thenable) returns existingRow,
      // UPDATE .returning() returns updatedRow
      const mockDb = buildMockDb([existingRow], { returningWith: [updatedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.addApiKey('add-key', 'sk-new', 'My New Key')

      expect(result.id).toBe('add-key')
      expect(result.apiKeys).toHaveLength(2)
    })

    it('adds a key to a provider that currently has no keys', async () => {
      const existingRow = makeDbRow({ providerId: 'empty-keys', apiKeys: [] })
      const updatedRow = makeDbRow({
        providerId: 'empty-keys',
        apiKeys: [{ id: 'new-key-id', key: 'sk-first', isEnabled: true, createdAt: 2000 }]
      })

      const mockDb = buildMockDb([existingRow], { returningWith: [updatedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.addApiKey('empty-keys', 'sk-first')

      expect(result.apiKeys).toHaveLength(1)
      expect(result.apiKeys[0]).not.toHaveProperty('key')
    })

    it('new key entry is enabled by default', async () => {
      const existingRow = makeDbRow({ providerId: 'default-enabled', apiKeys: [] })
      const updatedRow = makeDbRow({
        providerId: 'default-enabled',
        apiKeys: [{ id: 'nk', key: 'sk-x', isEnabled: true, createdAt: 2000 }]
      })

      const mockDb = buildMockDb([existingRow], { returningWith: [updatedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.addApiKey('default-enabled', 'sk-x')

      expect(result.apiKeys[0].isEnabled).toBe(true)
    })

    it('handles null apiKeys on existing provider', async () => {
      const existingRow = makeDbRow({ providerId: 'null-api-keys', apiKeys: null as any })
      const updatedRow = makeDbRow({
        providerId: 'null-api-keys',
        apiKeys: [{ id: 'new-id', key: 'sk-new', isEnabled: true, createdAt: 2000 }]
      })

      const mockDb = buildMockDb([existingRow], { returningWith: [updatedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.addApiKey('null-api-keys', 'sk-new')

      expect(result.apiKeys).toHaveLength(1)
    })

    it('stores the label on the new key entry', async () => {
      const existingRow = makeDbRow({ providerId: 'label-check', apiKeys: [] })
      // The updatedRow should reflect the label passed through
      const updatedRow = makeDbRow({
        providerId: 'label-check',
        apiKeys: [{ id: 'new-id', key: 'sk-labeled', label: 'My Label', isEnabled: true, createdAt: 2000 }]
      })

      const mockDb = buildMockDb([existingRow], { returningWith: [updatedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      const result = await svc.addApiKey('label-check', 'sk-labeled', 'My Label')

      expect(result.apiKeys[0].label).toBe('My Label')
    })
  })

  // ─── delete ───────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('throws not-found when the provider does not exist', async () => {
      const mockDb = buildMockDb([])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)

      const svc = ProviderService.getInstance()
      await expect(svc.delete('ghost')).rejects.toThrow()
      expect(DataApiErrorFactory.notFound).toHaveBeenCalledWith('Provider', 'ghost')
    })

    it('deletes an existing provider without throwing', async () => {
      const existingRow = makeDbRow({ providerId: 'to-delete' })

      // delete() calls getDb() first (for the delete op), then getByProviderId calls getDb() again
      vi.mocked(dbService.getDb)
        .mockReturnValueOnce(buildMockDb([]) as any) // for delete
        .mockReturnValueOnce(buildMockDb([existingRow]) as any) // for getByProviderId

      const svc = ProviderService.getInstance()
      await expect(svc.delete('to-delete')).resolves.toBeUndefined()
    })

    it('calls getByProviderId first to verify existence before deleting', async () => {
      const existingRow = makeDbRow({ providerId: 'verify-before-delete' })

      vi.mocked(dbService.getDb)
        .mockReturnValueOnce(buildMockDb([]) as any) // for delete
        .mockReturnValueOnce(buildMockDb([existingRow]) as any) // for getByProviderId

      const svc = ProviderService.getInstance()
      const getSpy = vi.spyOn(svc, 'getByProviderId')

      await svc.delete('verify-before-delete')

      expect(getSpy).toHaveBeenCalledWith('verify-before-delete')
    })
  })

  // ─── rowToRuntimeProvider (indirect tests via other methods) ───────────────

  describe('rowToRuntimeProvider mapping', () => {
    async function getProvider(row: UserProvider) {
      const mockDb = buildMockDb([row])
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as any)
      return ProviderService.getInstance().getByProviderId(row.providerId)
    }

    it('maps providerId to id', async () => {
      const provider = await getProvider(makeDbRow({ providerId: 'my-id' }))
      expect(provider.id).toBe('my-id')
    })

    it('maps null presetProviderId to undefined', async () => {
      const provider = await getProvider(makeDbRow({ presetProviderId: null }))
      expect(provider.presetProviderId).toBeUndefined()
    })

    it('maps non-null presetProviderId to string', async () => {
      const provider = await getProvider(makeDbRow({ presetProviderId: 'openai' }))
      expect(provider.presetProviderId).toBe('openai')
    })

    it('defaults authType to api-key when authConfig is null', async () => {
      const provider = await getProvider(makeDbRow({ authConfig: null }))
      expect(provider.authType).toBe('api-key')
    })

    it('uses authConfig.type as authType when present', async () => {
      const provider = await getProvider(makeDbRow({ authConfig: { type: 'oauth', clientId: 'client-abc' } }))
      expect(provider.authType).toBe('oauth')
    })

    it('merges DEFAULT_API_FEATURES with row apiFeatures', async () => {
      const provider = await getProvider(makeDbRow({ apiFeatures: { developerRole: true } as any }))
      // Defaults should be present
      expect(provider.apiFeatures.arrayContent).toBe(DEFAULT_API_FEATURES.arrayContent)
      // Override should be applied
      expect(provider.apiFeatures.developerRole).toBe(true)
    })

    it('uses DEFAULT_API_FEATURES when row apiFeatures is null', async () => {
      const provider = await getProvider(makeDbRow({ apiFeatures: null }))
      expect(provider.apiFeatures).toEqual(DEFAULT_API_FEATURES)
    })

    it('merges DEFAULT_PROVIDER_SETTINGS with row providerSettings', async () => {
      const provider = await getProvider(makeDbRow({ providerSettings: { timeout: 30000 } as any }))
      // Should have the overridden value
      expect(provider.settings.timeout).toBe(30000)
    })

    it('uses DEFAULT_PROVIDER_SETTINGS when row providerSettings is null', async () => {
      const provider = await getProvider(makeDbRow({ providerSettings: null }))
      expect(provider.settings).toEqual(DEFAULT_PROVIDER_SETTINGS)
    })

    it('maps null isEnabled to true', async () => {
      const provider = await getProvider(makeDbRow({ isEnabled: null as any }))
      expect(provider.isEnabled).toBe(true)
    })

    it('maps null baseUrls to undefined', async () => {
      const provider = await getProvider(makeDbRow({ baseUrls: null }))
      expect(provider.baseUrls).toBeUndefined()
    })

    it('maps null modelsApiUrls to undefined', async () => {
      const provider = await getProvider(makeDbRow({ modelsApiUrls: null }))
      expect(provider.modelsApiUrls).toBeUndefined()
    })

    it('maps null defaultChatEndpoint to undefined', async () => {
      const provider = await getProvider(makeDbRow({ defaultChatEndpoint: null }))
      expect(provider.defaultChatEndpoint).toBeUndefined()
    })

    it('maps null websites to undefined', async () => {
      const provider = await getProvider(makeDbRow({ websites: null }))
      expect(provider.websites).toBeUndefined()
    })

    it('exposes websites when present', async () => {
      const provider = await getProvider(
        makeDbRow({ websites: { official: 'https://openai.com', docs: 'https://platform.openai.com/docs' } })
      )
      expect(provider.websites?.official).toBe('https://openai.com')
      expect(provider.websites?.docs).toBe('https://platform.openai.com/docs')
    })

    it('strips key values from all apiKey entries (security)', async () => {
      const provider = await getProvider(
        makeDbRow({
          apiKeys: [
            { id: 'k1', key: 'sk-secret-1', label: 'Primary', isEnabled: true, createdAt: 1000 },
            { id: 'k2', key: 'sk-secret-2', isEnabled: false, createdAt: 2000 }
          ]
        })
      )

      expect(provider.apiKeys).toHaveLength(2)
      for (const entry of provider.apiKeys) {
        expect(entry).not.toHaveProperty('key')
      }
      expect(provider.apiKeys[0].id).toBe('k1')
      expect(provider.apiKeys[0].label).toBe('Primary')
      expect(provider.apiKeys[0].isEnabled).toBe(true)
      expect(provider.apiKeys[1].id).toBe('k2')
      expect(provider.apiKeys[1].isEnabled).toBe(false)
    })

    it('handles null apiKeys by producing an empty apiKeys array', async () => {
      const provider = await getProvider(makeDbRow({ apiKeys: null as any }))
      expect(provider.apiKeys).toEqual([])
    })

    it('defaults authType to api-key when authConfig has no type field', async () => {
      const provider = await getProvider(makeDbRow({ authConfig: { clientId: 'abc' } as any }))
      expect(provider.authType).toBe('api-key')
    })

    it('passes through baseUrls when non-null', async () => {
      const urls = { [EndpointType.OPENAI_CHAT_COMPLETIONS]: 'https://api.example.com/v1' }
      const provider = await getProvider(makeDbRow({ baseUrls: urls as any }))
      expect(provider.baseUrls).toEqual(urls)
    })

    it('passes through modelsApiUrls when non-null', async () => {
      const urls = { list: 'https://api.example.com/models' }
      const provider = await getProvider(makeDbRow({ modelsApiUrls: urls as any }))
      expect(provider.modelsApiUrls).toEqual(urls)
    })

    it('passes through defaultChatEndpoint when non-null', async () => {
      const provider = await getProvider(makeDbRow({ defaultChatEndpoint: '/v1/chat/completions' as any }))
      expect(provider.defaultChatEndpoint).toBe('/v1/chat/completions')
    })
  })
})
