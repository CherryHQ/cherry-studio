/**
 * Tests for ModelService — field mapping, update behavior, and create merge logic.
 */

import { pinTable } from '@data/db/schemas/pin'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService, UPDATE_MODEL_FIELD_MAP } from '@data/services/ModelService'
import { pinService } from '@data/services/PinService'
import type * as ProviderRegistryServiceModule from '@data/services/ProviderRegistryService'
import { generateOrderKeyBetween, generateOrderKeySequence } from '@data/services/utils/orderKey'
import { ErrorCode } from '@shared/data/api'
import type { UpdateModelDto } from '@shared/data/api/schemas/models'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq, or } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../tests/__mocks__/MainLoggerService'

vi.mock('@data/services/ProviderRegistryService', async (importOriginal) => {
  const actual = await importOriginal<typeof ProviderRegistryServiceModule>()
  return {
    ...actual,
    providerRegistryService: {}
  }
})

function providerRow(providerId: string, name: string, orderKey = generateOrderKeyBetween(null, null)) {
  return { providerId, name, orderKey }
}

type NewUserModel = typeof userModelTable.$inferInsert

function modelRow(providerId: string, modelId: string, values: Partial<NewUserModel> = {}): NewUserModel {
  return {
    id: createUniqueModelId(providerId, modelId),
    providerId,
    modelId,
    name: modelId,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    isDeprecated: false,
    orderKey: generateOrderKeyBetween(null, null),
    ...values
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FIELD_MAP completeness — prevents forgetting to map new DTO fields
// ─────────────────────────────────────────────────────────────────────────────

describe('UPDATE_MODEL_FIELD_MAP completeness', () => {
  it('covers every key in UpdateModelDto', () => {
    const dtoKeys: (keyof UpdateModelDto)[] = [
      'name',
      'description',
      'group',
      'capabilities',
      'inputModalities',
      'outputModalities',
      'endpointTypes',
      'parameterSupport',
      'supportsStreaming',
      'contextWindow',
      'maxInputTokens',
      'maxOutputTokens',
      'reasoning',
      'pricing',
      'isEnabled',
      'isHidden',
      'isDeprecated',
      'notes'
    ]

    const mappedDtoKeys = UPDATE_MODEL_FIELD_MAP.map((entry) => (Array.isArray(entry) ? entry[0] : entry))

    for (const key of dtoKeys) {
      expect(mappedDtoKeys, `FIELD_MAP is missing DTO key: "${String(key)}"`).toContain(key)
    }
    for (const key of mappedDtoKeys) {
      expect(dtoKeys, `FIELD_MAP has stale key: "${String(key)}" not in UpdateModelDto`).toContain(key)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ModelService.update — edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('ModelService.update', () => {
  const dbh = setupTestDatabase()

  async function seedExistingModel() {
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))
    await dbh.db.insert(userModelTable).values(
      modelRow('openai', 'gpt-4o', {
        presetModelId: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: ['function-call'],
        inputModalities: ['text'],
        outputModalities: ['text'],
        contextWindow: 128_000,
        maxOutputTokens: 4096,
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false,
        isDeprecated: false
      })
    )
  }

  it('only writes provided fields — partial update does not clear others', async () => {
    await seedExistingModel()

    await modelService.update('openai', 'gpt-4o', { name: 'New Name' })

    const [row] = await dbh.db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.modelId, 'gpt-4o')))

    expect(row.name).toBe('New Name')
    expect(row.capabilities).toEqual(['function-call'])
    expect(row.contextWindow).toBe(128_000)
    expect(row.maxOutputTokens).toBe(4096)
  })

  it('exposes presetModelId in runtime model responses for sync diff ownership', async () => {
    await seedExistingModel()

    const [model] = await modelService.list({ providerId: 'openai' })

    expect(model).toMatchObject({
      id: 'openai::gpt-4o',
      presetModelId: 'gpt-4o'
    })
  })

  it('parameterSupport DTO key maps to parameters DB column', async () => {
    await seedExistingModel()

    const params = { temperature: { supported: true } } as any
    await modelService.update('openai', 'gpt-4o', { parameterSupport: params })

    const [row] = await dbh.db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.modelId, 'gpt-4o')))

    expect(row.parameters).toEqual(params)
  })

  it('throws NOT_FOUND when model does not exist', async () => {
    await expect(modelService.update('openai', 'nonexistent', { name: 'x' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      status: 404
    })
  })

  it('adds enrichable field to userOverrides when changed', async () => {
    await seedExistingModel()

    await modelService.update('openai', 'gpt-4o', { name: 'Updated Name' })

    const [row] = await dbh.db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.modelId, 'gpt-4o')))

    expect(row.userOverrides).toContain('name')
  })

  it('does not add non-enrichable fields to userOverrides', async () => {
    await seedExistingModel()

    await modelService.update('openai', 'gpt-4o', { isEnabled: false })

    const [row] = await dbh.db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.modelId, 'gpt-4o')))

    expect(row.userOverrides ?? []).toEqual([])
  })

  it('updates isDeprecated without touching enrichable overrides', async () => {
    await seedExistingModel()

    await modelService.update('openai', 'gpt-4o', { isDeprecated: true })

    const [row] = await dbh.db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.modelId, 'gpt-4o')))

    expect(row.isDeprecated).toBe(true)
    expect(row.userOverrides ?? []).toEqual([])
  })

  it('preserves existing userOverrides when adding new ones', async () => {
    await seedExistingModel()

    await modelService.update('openai', 'gpt-4o', { name: 'Name V2' })
    await modelService.update('openai', 'gpt-4o', { description: 'A description' })

    const [row] = await dbh.db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.modelId, 'gpt-4o')))

    expect(row.userOverrides).toContain('name')
    expect(row.userOverrides).toContain('description')
  })

  it('maps parameterSupport DTO key to parameters in userOverrides', async () => {
    await seedExistingModel()

    const params = { temperature: { supported: true } } as any
    await modelService.update('openai', 'gpt-4o', { parameterSupport: params })

    const [row] = await dbh.db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.modelId, 'gpt-4o')))

    expect(row.userOverrides).toContain('parameters')
  })

  it('returns existing model unchanged when DTO is empty', async () => {
    await seedExistingModel()

    const result = await modelService.update('openai', 'gpt-4o', {})

    expect(result.name).toBe('GPT-4o')
    expect(result.contextWindow).toBe(128_000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ModelService.create — merge behavior and batch semantics
// ─────────────────────────────────────────────────────────────────────────────

describe('ModelService.create', () => {
  const dbh = setupTestDatabase()

  it('null DTO fields do not clobber preset during merge', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))

    const dto = {
      providerId: 'openai',
      modelId: 'gpt-4o'
      // all optional fields omitted → null in dtoToNewUserModel
    }

    const registryData = {
      presetModel: {
        id: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: ['function-call'],
        inputModalities: ['text'],
        contextWindow: 128_000,
        maxOutputTokens: 4096
      } as any,
      registryOverride: null
    }

    const [created] = await modelService.create([{ dto, registryData }])

    expect(created.name).toBe('GPT-4o')
    expect(created.capabilities).toEqual(['function-call'])
    expect(created.contextWindow).toBe(128_000)

    const [row] = await dbh.db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.modelId, 'gpt-4o')))

    expect(row.name).toBe('GPT-4o')
    expect(row.capabilities).toEqual(['function-call'])
    expect(row.contextWindow).toBe(128_000)
  })

  it('uses DTO maxInputTokens over registry values during merge', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))

    const [created] = await modelService.create([
      {
        dto: {
          providerId: 'openai',
          modelId: 'gpt-4o',
          maxInputTokens: 64_000,
          maxOutputTokens: 8_192
        },
        registryData: {
          presetModel: {
            id: 'gpt-4o',
            name: 'GPT-4o',
            maxInputTokens: 128_000,
            maxOutputTokens: 4_096
          } as any,
          registryOverride: null
        }
      }
    ])

    expect(created.maxInputTokens).toBe(64_000)
    expect(created.maxOutputTokens).toBe(8_192)

    const [row] = await dbh.db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.modelId, 'gpt-4o')))

    expect(row.maxInputTokens).toBe(64_000)
    expect(row.maxOutputTokens).toBe(8_192)
  })

  it('logs custom model creation when dto presetModelId is present without a registry match', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))

    const infoSpy = vi.spyOn(mockMainLoggerService, 'info').mockImplementation(() => {})

    await modelService.create([
      {
        dto: {
          providerId: 'openai',
          modelId: 'custom-gpt',
          presetModelId: 'preset-from-dto',
          name: 'Custom GPT'
        }
      }
    ])

    expect(infoSpy).toHaveBeenCalledWith('Created custom model (no registry match)', {
      providerId: 'openai',
      modelId: 'custom-gpt'
    })
  })

  it('translates duplicate model create into a 409 conflict', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))
    await dbh.db.insert(userModelTable).values(modelRow('openai', 'gpt-4o', { name: 'GPT-4o' }))

    await expect(
      modelService.create([
        {
          dto: {
            providerId: 'openai',
            modelId: 'gpt-4o',
            name: 'Duplicate GPT-4o'
          }
        }
      ])
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      status: 409,
      message: expect.stringContaining('openai/gpt-4o')
    })
  })

  it('builds all rows with the same registry-aware merge semantics as create', async () => {
    const [openaiOrderKey, customOrderKey] = generateOrderKeySequence(2)
    await dbh.db
      .insert(userProviderTable)
      .values([providerRow('openai', 'OpenAI', openaiOrderKey), providerRow('custom', 'Custom', customOrderKey)])

    const batch = [
      {
        dto: {
          providerId: 'openai',
          modelId: 'gpt-4o'
        },
        registryData: {
          presetModel: {
            id: 'gpt-4o',
            name: 'GPT-4o',
            capabilities: ['function-call'],
            inputModalities: ['text'],
            contextWindow: 128_000,
            maxOutputTokens: 4096
          } as any,
          registryOverride: null
        }
      },
      {
        dto: {
          providerId: 'custom',
          modelId: 'my-model',
          name: 'My Model',
          endpointTypes: ['openai']
        }
      }
    ]

    const created = await modelService.create(batch as any)

    expect(created).toHaveLength(2)
    expect(created[0]).toMatchObject({
      id: 'openai::gpt-4o',
      providerId: 'openai',
      apiModelId: 'gpt-4o',
      name: 'GPT-4o',
      capabilities: ['function-call'],
      contextWindow: 128_000
    })
    expect(created[1]).toMatchObject({
      id: 'custom::my-model',
      providerId: 'custom',
      apiModelId: 'my-model',
      name: 'My Model',
      endpointTypes: ['openai']
    })

    const rows = await dbh.db
      .select()
      .from(userModelTable)
      .where(
        or(
          and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.modelId, 'gpt-4o')),
          and(eq(userModelTable.providerId, 'custom'), eq(userModelTable.modelId, 'my-model'))
        )
      )

    expect(rows).toHaveLength(2)
    const openaiRow = rows.find((r) => r.providerId === 'openai')
    const customRow = rows.find((r) => r.providerId === 'custom')
    expect(openaiRow).toMatchObject({
      providerId: 'openai',
      modelId: 'gpt-4o',
      presetModelId: 'gpt-4o',
      name: 'GPT-4o',
      capabilities: ['function-call'],
      contextWindow: 128_000
    })
    expect(customRow).toMatchObject({
      providerId: 'custom',
      modelId: 'my-model',
      presetModelId: null,
      name: 'My Model',
      endpointTypes: ['openai']
    })
  })

  it('rolls back all inserts when one item conflicts (transaction atomicity)', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))
    await dbh.db.insert(userModelTable).values(modelRow('openai', 'gpt-4o', { name: 'GPT-4o' }))

    await expect(
      modelService.create([
        {
          dto: {
            providerId: 'openai',
            modelId: 'gpt-new',
            name: 'New Model'
          }
        },
        {
          dto: {
            providerId: 'openai',
            modelId: 'gpt-4o',
            name: 'Duplicate GPT-4o'
          }
        }
      ])
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      status: 409
    })

    // Verify the new model was NOT inserted (transaction rolled back)
    const rows = await dbh.db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.modelId, 'gpt-new')))

    expect(rows).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ModelService.delete — pin cleanup
// ─────────────────────────────────────────────────────────────────────────────

describe('ModelService.delete', () => {
  const dbh = setupTestDatabase()

  it('purges model pins when deleting the model row', async () => {
    const modelId = createUniqueModelId('openai', 'gpt-4o')

    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))
    await dbh.db.insert(userModelTable).values(modelRow('openai', 'gpt-4o', { id: modelId, name: 'GPT-4o' }))
    await dbh.db.insert(pinTable).values({
      entityType: 'model',
      entityId: modelId,
      orderKey: 'a0'
    })

    await modelService.delete('openai', 'gpt-4o')

    const pins = await dbh.db.select().from(pinTable).where(eq(pinTable.entityId, modelId))
    expect(pins).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ModelService.list — query and filter behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('ModelService.list', () => {
  const dbh = setupTestDatabase()

  async function seedMultipleModels() {
    const [openaiOrderKey, anthropicOrderKey] = generateOrderKeySequence(2)
    await dbh.db
      .insert(userProviderTable)
      .values([
        providerRow('openai', 'OpenAI', openaiOrderKey),
        providerRow('anthropic', 'Anthropic', anthropicOrderKey)
      ])
    await dbh.db.insert(userModelTable).values([
      modelRow('openai', 'gpt-4o', {
        name: 'GPT-4o',
        capabilities: ['function-call'],
        isEnabled: true,
        isDeprecated: false
      }),
      modelRow('openai', 'gpt-3.5', {
        name: 'GPT-3.5',
        capabilities: ['embedding'],
        isEnabled: false,
        isDeprecated: false
      }),
      modelRow('anthropic', 'claude-3', {
        name: 'Claude 3',
        capabilities: ['function-call', 'reasoning'],
        isEnabled: true,
        isDeprecated: false
      })
    ])
  }

  it('returns all models when no filters', async () => {
    await seedMultipleModels()

    const models = await modelService.list({})

    expect(models).toHaveLength(3)
  })

  it('filters by providerId', async () => {
    await seedMultipleModels()

    const models = await modelService.list({ providerId: 'openai' })

    expect(models).toHaveLength(2)
    expect(models.every((m) => m.providerId === 'openai')).toBe(true)
  })

  it('filters by enabled status', async () => {
    await seedMultipleModels()

    const enabled = await modelService.list({ enabled: true })
    expect(enabled).toHaveLength(2)

    const disabled = await modelService.list({ enabled: false })
    expect(disabled).toHaveLength(1)
    expect(disabled[0].apiModelId).toBe('gpt-3.5')
  })

  it('filters by capability (post-filter)', async () => {
    await seedMultipleModels()

    const models = await modelService.list({ capability: 'reasoning' as any })

    expect(models).toHaveLength(1)
    expect(models[0].apiModelId).toBe('claude-3')
  })

  it('combines providerId and enabled filters', async () => {
    await seedMultipleModels()

    const models = await modelService.list({ providerId: 'openai', enabled: true })

    expect(models).toHaveLength(1)
    expect(models[0].apiModelId).toBe('gpt-4o')
  })

  it('returns empty array when no models match', async () => {
    await seedMultipleModels()

    const models = await modelService.list({ providerId: 'nonexistent' })

    expect(models).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ModelService.getByKey — single model lookup
// ─────────────────────────────────────────────────────────────────────────────

describe('ModelService.getByKey', () => {
  const dbh = setupTestDatabase()

  it('returns model for valid composite key', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))
    await dbh.db.insert(userModelTable).values(modelRow('openai', 'gpt-4o', { name: 'GPT-4o' }))

    const model = await modelService.getByKey('openai', 'gpt-4o')

    expect(model.providerId).toBe('openai')
    expect(model.apiModelId).toBe('gpt-4o')
    expect(model.name).toBe('GPT-4o')
  })

  it('throws NOT_FOUND for non-existent model', async () => {
    await expect(modelService.getByKey('openai', 'nonexistent')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      status: 404
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ModelService.findByIdTx — tx-aware nullable model lookup
// ─────────────────────────────────────────────────────────────────────────────

describe('ModelService.findByIdTx', () => {
  const dbh = setupTestDatabase()

  it('returns the model when the unique model id exists', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))
    const uid = createUniqueModelId('openai', 'gpt-4o')
    await dbh.db.insert(userModelTable).values(modelRow('openai', 'gpt-4o', { id: uid, name: 'GPT-4o' }))

    await expect(modelService.findByIdTx(dbh.db, uid)).resolves.toMatchObject({
      id: uid,
      name: 'GPT-4o'
    })
  })

  it('returns null when the unique model id is missing', async () => {
    await expect(modelService.findByIdTx(dbh.db, 'openai::nope')).resolves.toBeNull()
  })

  it('observes a freshly-inserted row inside the same transaction', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))
    const uid = createUniqueModelId('openai', 'gpt-4o')

    await dbh.db.transaction(async (tx) => {
      await tx.insert(userModelTable).values(modelRow('openai', 'gpt-4o', { id: uid, name: 'GPT-4o' }))
      await expect(modelService.findByIdTx(tx, uid)).resolves.toMatchObject({ id: uid })
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ModelService.batchUpsert — registry sync overwrite protection
// ─────────────────────────────────────────────────────────────────────────────

describe('ModelService.batchUpsert', () => {
  const dbh = setupTestDatabase()

  it('skips enrichable user-overridden fields while still updating presetModelId', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))
    await dbh.db.insert(userModelTable).values(
      modelRow('openai', 'gpt-4o', {
        presetModelId: 'gpt-4o-legacy',
        name: 'My Custom Name',
        capabilities: ['function-call'],
        contextWindow: 32_000,
        userOverrides: ['name', 'contextWindow']
      })
    )

    await modelService.batchUpsert([
      modelRow('openai', 'gpt-4o', {
        presetModelId: 'gpt-4o',
        name: 'Registry Name',
        capabilities: ['reasoning'],
        contextWindow: 128_000,
        maxOutputTokens: 8192
      })
    ])

    const [row] = await dbh.db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.modelId, 'gpt-4o')))

    expect(row.presetModelId).toBe('gpt-4o')
    expect(row.name).toBe('My Custom Name')
    expect(row.contextWindow).toBe(32_000)
    expect(row.capabilities).toEqual(['reasoning'])
    expect(row.maxOutputTokens).toBe(8192)
    expect(row.userOverrides).toEqual(['name', 'contextWindow'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ModelService.getNamesByUniqueIdsTx — tx-aware batch name resolution for embeds
// ─────────────────────────────────────────────────────────────────────────────

describe('ModelService.getNamesByUniqueIdsTx', () => {
  const dbh = setupTestDatabase()

  it('returns a map of names keyed by UniqueModelId', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))
    const uid1 = createUniqueModelId('openai', 'gpt-4o')
    const uid2 = createUniqueModelId('openai', 'gpt-4o-mini')
    await dbh.db
      .insert(userModelTable)
      .values([
        modelRow('openai', 'gpt-4o', { id: uid1, name: 'GPT-4o' }),
        modelRow('openai', 'gpt-4o-mini', { id: uid2, name: 'GPT-4o mini' })
      ])

    const result = await modelService.getNamesByUniqueIdsTx(dbh.db, [uid1, uid2, 'openai::missing'])

    expect(result.get(uid1)).toBe('GPT-4o')
    expect(result.get(uid2)).toBe('GPT-4o mini')
    expect(result.has('openai::missing')).toBe(false)
  })

  it('filters null / undefined / empty inputs and dedupes', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))
    const uid = createUniqueModelId('openai', 'gpt-4o')
    await dbh.db.insert(userModelTable).values(modelRow('openai', 'gpt-4o', { id: uid, name: 'GPT-4o' }))

    const result = await modelService.getNamesByUniqueIdsTx(dbh.db, [uid, uid, null, undefined, ''])

    expect(result.size).toBe(1)
    expect(result.get(uid)).toBe('GPT-4o')
  })

  it('omits rows with empty name (no synthetic blank label)', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))
    const uidEmpty = createUniqueModelId('openai', 'gpt-empty')
    await dbh.db.insert(userModelTable).values([modelRow('openai', 'gpt-empty', { id: uidEmpty, name: '' })])

    const result = await modelService.getNamesByUniqueIdsTx(dbh.db, [uidEmpty])

    expect(result.has(uidEmpty)).toBe(false)
  })

  it('returns an empty map for empty input without querying', async () => {
    const result = await modelService.getNamesByUniqueIdsTx(dbh.db, [])
    expect(result.size).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ModelService.delete — removal behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('ModelService.delete', () => {
  const dbh = setupTestDatabase()

  it('removes the model row from the database', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))
    await dbh.db.insert(userModelTable).values(modelRow('openai', 'gpt-4o', { name: 'GPT-4o' }))

    await modelService.delete('openai', 'gpt-4o')

    const rows = await dbh.db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.modelId, 'gpt-4o')))

    expect(rows).toHaveLength(0)
  })

  it('purges pins that target the deleted model id', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))
    const targetModelId = createUniqueModelId('openai', 'gpt-4o')
    const siblingModelId = createUniqueModelId('openai', 'gpt-4o-mini')
    await dbh.db
      .insert(userModelTable)
      .values([
        modelRow('openai', 'gpt-4o', { id: targetModelId, name: 'GPT-4o' }),
        modelRow('openai', 'gpt-4o-mini', { id: siblingModelId, name: 'GPT-4o mini' })
      ])
    const targetPin = await pinService.pin({ entityType: 'model', entityId: targetModelId })
    const siblingPin = await pinService.pin({ entityType: 'model', entityId: siblingModelId })

    await modelService.delete('openai', 'gpt-4o')

    const pins = await dbh.db.select().from(pinTable)
    expect(pins.find((pin) => pin.id === targetPin.id)).toBeUndefined()
    expect(pins.find((pin) => pin.id === siblingPin.id)).toBeDefined()
  })

  it('throws NOT_FOUND for non-existent model', async () => {
    await expect(modelService.delete('openai', 'nonexistent')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      status: 404
    })
  })
})

describe('ModelService.bulkUpdate', () => {
  const dbh = setupTestDatabase()

  it('rolls back the whole batch when one item is missing (atomic update)', async () => {
    // T3: pin the cross-row atomicity of bulkUpdate. A NOT_FOUND on item 2
    // must NOT leave item 1's update committed.
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))
    await dbh.db.insert(userModelTable).values([modelRow('openai', 'gpt-4o', { name: 'GPT-4o-original' })])

    const originalGpt4o = await dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.id, createUniqueModelId('openai', 'gpt-4o')))
      .then((rows) => rows[0])

    await expect(
      modelService.bulkUpdate([
        { providerId: 'openai', modelId: 'gpt-4o', patch: { name: 'GPT-4o-new' } },
        { providerId: 'openai', modelId: 'missing', patch: { name: 'should-rollback' } }
      ])
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })

    const afterRollback = await dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.id, createUniqueModelId('openai', 'gpt-4o')))
      .then((rows) => rows[0])
    expect(afterRollback?.name).toBe(originalGpt4o.name)
    expect(afterRollback?.name).toBe('GPT-4o-original')
  })
})

describe('ModelService.reconcileForProvider', () => {
  const dbh = setupTestDatabase()

  it('removes only the target provider rows, purges their pins, and chunks large inserts', async () => {
    // T2: service-level coverage for the atomic reconcile path. The renderer
    // test (T6 in usePullReconcileSubmit.test.ts) covers the aggregation
    // contract; this test pins the DB-side guarantees: cross-provider
    // isolation, pin cascade on remove, and per-INSERT chunking inside the
    // single transaction.
    await dbh.db
      .insert(userProviderTable)
      .values([providerRow('openai', 'OpenAI'), providerRow('anthropic', 'Anthropic')])

    const openaiGpt4o = createUniqueModelId('openai', 'gpt-4o')
    const openaiGpt4oMini = createUniqueModelId('openai', 'gpt-4o-mini')
    const anthropicClaude = createUniqueModelId('anthropic', 'claude-3-5-sonnet')
    await dbh.db
      .insert(userModelTable)
      .values([
        modelRow('openai', 'gpt-4o', { id: openaiGpt4o }),
        modelRow('openai', 'gpt-4o-mini', { id: openaiGpt4oMini }),
        modelRow('anthropic', 'claude-3-5-sonnet', { id: anthropicClaude })
      ])

    await pinService.pin({ entityType: 'model', entityId: openaiGpt4o })
    await pinService.pin({ entityType: 'model', entityId: anthropicClaude })

    // Cross MODELS_RECONCILE per-INSERT chunk size of 500 (use 600).
    const toAdd = Array.from({ length: 600 }, (_, index) => ({
      dto: {
        providerId: 'openai',
        modelId: `bulk-model-${index}`,
        name: `Bulk Model ${index}`
      } as const,
      registryData: undefined
    }))

    const result = await modelService.reconcileForProvider('openai', {
      toAdd,
      toRemove: [openaiGpt4o]
    })

    // openai: old gpt-4o-mini + 600 new = 601 rows; gpt-4o is gone.
    expect(result.length).toBe(601)
    expect(result.find((m) => m.id === openaiGpt4o)).toBeUndefined()
    expect(result.find((m) => m.id === openaiGpt4oMini)).toBeDefined()
    expect(result.filter((m) => m.id.startsWith('openai::bulk-model-')).length).toBe(600)

    // anthropic untouched by the openai reconcile.
    const anthropicRows = await dbh.db.select().from(userModelTable).where(eq(userModelTable.providerId, 'anthropic'))
    expect(anthropicRows.map((r) => r.id)).toEqual([anthropicClaude])

    // Pin for the removed openai model is gone; pin for anthropic survives.
    const remainingPins = await dbh.db.select().from(pinTable).where(eq(pinTable.entityType, 'model'))
    expect(remainingPins.map((p) => p.entityId).sort()).toEqual([anthropicClaude].sort())

    // Inserted rows have strictly-increasing order keys across chunk boundaries.
    const bulkRows = result.filter((m) => m.id.startsWith('openai::bulk-model-'))
    const bulkOrderKeys = await dbh.db
      .select()
      .from(userModelTable)
      .where(or(...bulkRows.map((m) => and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.id, m.id))!)))
    const sortedKeys = bulkOrderKeys.map((r) => r.orderKey).sort()
    expect(new Set(sortedKeys).size).toBe(sortedKeys.length)
  })

  it('warns when toRemove references IDs that do not exist for this provider', async () => {
    // S2 regression coverage: stale renderer state passes a toRemove with a
    // non-existent id; reconcile completes but logs the count mismatch.
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))
    await dbh.db
      .insert(userModelTable)
      .values([modelRow('openai', 'gpt-4o', { id: createUniqueModelId('openai', 'gpt-4o') })])

    const warnSpy = vi.spyOn(mockMainLoggerService, 'warn').mockImplementation(() => {})
    await modelService.reconcileForProvider('openai', {
      toAdd: [],
      toRemove: [createUniqueModelId('openai', 'gpt-4o'), createUniqueModelId('openai', 'never-existed')]
    })

    expect(warnSpy).toHaveBeenCalledWith(
      'Reconcile toRemove count mismatch',
      expect.objectContaining({
        providerId: 'openai',
        requestedRemove: 2,
        actuallyDeleted: 1
      })
    )
    warnSpy.mockRestore()
  })
})
