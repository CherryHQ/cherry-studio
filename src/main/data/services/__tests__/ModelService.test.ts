/**
 * Tests for ModelService — field mapping, update behavior, and create merge logic.
 */

import { userModelTable } from '@data/db/schemas/userModel'
import { modelService, UPDATE_MODEL_FIELD_MAP } from '@data/services/ModelService'
import type { UpdateModelDto } from '@shared/data/api/schemas/models'
import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

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
    await dbh.db.insert(userModelTable).values({
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
})

// ─────────────────────────────────────────────────────────────────────────────
// ModelService.create — merge behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('ModelService.create', () => {
  const dbh = setupTestDatabase()

  it('null DTO fields do not clobber preset during merge', async () => {
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

    const created = await modelService.create(dto, registryData)

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
})
