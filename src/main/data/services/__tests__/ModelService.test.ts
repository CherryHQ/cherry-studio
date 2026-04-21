/**
 * Tests for ModelService — field mapping, update behavior, and create merge logic.
 */

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService, UPDATE_MODEL_FIELD_MAP } from '@data/services/ModelService'
import { ErrorCode } from '@shared/data/api'
import type { UpdateModelDto } from '@shared/data/api/schemas/models'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq, or } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../tests/__mocks__/MainLoggerService'

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: {}
}))

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
      'maxOutputTokens',
      'reasoning',
      'pricing',
      'isEnabled',
      'isHidden',
      'sortOrder',
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
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai',
      name: 'OpenAI'
    })
    await dbh.db.insert(userModelTable).values({
      id: createUniqueModelId('openai', 'gpt-4o'),
      providerId: 'openai',
      modelId: 'gpt-4o',
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
      sortOrder: 0
    })
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
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai',
      name: 'OpenAI'
    })

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

  it('logs custom model creation when dto presetModelId is present without a registry match', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai',
      name: 'OpenAI'
    })

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
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai',
      name: 'OpenAI'
    })
    await dbh.db.insert(userModelTable).values({
      id: createUniqueModelId('openai', 'gpt-4o'),
      providerId: 'openai',
      modelId: 'gpt-4o',
      name: 'GPT-4o'
    })

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
    await dbh.db.insert(userProviderTable).values([
      { providerId: 'openai', name: 'OpenAI' },
      { providerId: 'custom', name: 'Custom' }
    ])

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
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai',
      name: 'OpenAI'
    })
    await dbh.db.insert(userModelTable).values({
      id: createUniqueModelId('openai', 'gpt-4o'),
      providerId: 'openai',
      modelId: 'gpt-4o',
      name: 'GPT-4o'
    })

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
// ModelService.list — query and filter behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('ModelService.list', () => {
  const dbh = setupTestDatabase()

  async function seedMultipleModels() {
    await dbh.db.insert(userProviderTable).values([
      { providerId: 'openai', name: 'OpenAI' },
      { providerId: 'anthropic', name: 'Anthropic' }
    ])
    await dbh.db.insert(userModelTable).values([
      {
        id: createUniqueModelId('openai', 'gpt-4o'),
        providerId: 'openai',
        modelId: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: ['function-call'],
        isEnabled: true,
        sortOrder: 0
      },
      {
        id: createUniqueModelId('openai', 'gpt-3.5'),
        providerId: 'openai',
        modelId: 'gpt-3.5',
        name: 'GPT-3.5',
        capabilities: ['embedding'],
        isEnabled: false,
        sortOrder: 1
      },
      {
        id: createUniqueModelId('anthropic', 'claude-3'),
        providerId: 'anthropic',
        modelId: 'claude-3',
        name: 'Claude 3',
        capabilities: ['function-call', 'reasoning'],
        isEnabled: true,
        sortOrder: 0
      }
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
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai',
      name: 'OpenAI'
    })
    await dbh.db.insert(userModelTable).values({
      id: createUniqueModelId('openai', 'gpt-4o'),
      providerId: 'openai',
      modelId: 'gpt-4o',
      name: 'GPT-4o'
    })

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
// ModelService.delete — removal behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('ModelService.delete', () => {
  const dbh = setupTestDatabase()

  it('removes the model row from the database', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai',
      name: 'OpenAI'
    })
    await dbh.db.insert(userModelTable).values({
      id: createUniqueModelId('openai', 'gpt-4o'),
      providerId: 'openai',
      modelId: 'gpt-4o',
      name: 'GPT-4o'
    })

    await modelService.delete('openai', 'gpt-4o')

    const rows = await dbh.db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.modelId, 'gpt-4o')))

    expect(rows).toHaveLength(0)
  })

  it('throws NOT_FOUND for non-existent model', async () => {
    await expect(modelService.delete('openai', 'nonexistent')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
      status: 404
    })
  })
})
