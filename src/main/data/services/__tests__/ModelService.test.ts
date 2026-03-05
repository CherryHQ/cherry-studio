/**
 * Unit tests for ModelService
 *
 * Tests all public methods:
 * - getInstance (singleton)
 * - list (with/without filters)
 * - getByKey (found / not-found)
 * - create (with and without catalog enrichment)
 * - update (partial fields, model-not-found)
 * - delete (existing, not-found)
 * - batchUpsert (multiple models, empty array)
 * - rowToRuntimeModel (field mapping, fallbacks) — exercised indirectly
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Module mocks (hoisted by Vitest) ────────────────────────────────────────

vi.mock('../CatalogService', () => ({
  catalogService: {
    lookupModel: vi.fn()
  }
}))

vi.mock('@shared/data/utils/modelMerger', () => ({
  mergeModelConfig: vi.fn()
}))

// DataApiErrorFactory — use real implementation so error instances carry the
// correct code, but keep it importable for assertion.
// (No mock needed; the real factory produces plain Error subclasses.)

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { dbService } from '@main/data/db/DbService'
import { ErrorCode } from '@shared/data/api'
import { mergeModelConfig } from '@shared/data/utils/modelMerger'

import { catalogService } from '../CatalogService'
import { ModelService } from '../ModelService'

// ─── Helpers / Fixtures ───────────────────────────────────────────────────────

/**
 * Build a minimal UserModel DB row (all nullable fields default to null).
 */
function makeDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-uuid-1',
    providerId: 'openai',
    modelId: 'gpt-4o',
    modelApiId: null,
    presetModelId: null,
    name: 'GPT-4o',
    description: null,
    group: null,
    capabilities: ['FUNCTION_CALL'] as string[],
    inputModalities: null,
    outputModalities: null,
    endpointTypes: null,
    customEndpointUrl: null,
    contextWindow: 128_000,
    maxOutputTokens: null,
    supportsStreaming: true,
    reasoning: null,
    parameters: null,
    pricing: null,
    isEnabled: true,
    isHidden: false,
    sortOrder: 0,
    notes: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

/**
 * Minimal preset ModelConfig object returned by catalogService.lookupModel.
 */
function makePresetModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gpt-4o',
    name: 'GPT-4o',
    metadata: {},
    capabilities: ['FUNCTION_CALL'],
    contextWindow: 128_000,
    ...overrides
  }
}

/**
 * Minimal merged Model returned by mergeModelConfig.
 */
function makeMergedModel(providerId = 'openai', modelId = 'gpt-4o') {
  return {
    id: `${providerId}::${modelId}` as `${string}::${string}`,
    providerId,
    apiModelId: modelId,
    name: 'GPT-4o',
    description: undefined,
    group: undefined,
    capabilities: ['FUNCTION_CALL'],
    inputModalities: undefined,
    outputModalities: undefined,
    contextWindow: 128_000,
    maxOutputTokens: undefined,
    endpointTypes: undefined,
    supportsStreaming: true,
    reasoning: undefined,
    parameters: undefined,
    pricing: undefined,
    isEnabled: true,
    isHidden: false
  }
}

// ─── Mock DB builder ──────────────────────────────────────────────────────────

/**
 * Builds a chainable Drizzle-like mock DB object.
 *
 * The mock lets you configure the final resolved value for each operation
 * family (select, insert, update, delete) independently.
 */
function buildMockDb({
  selectRows = [] as unknown[],
  insertRows = [] as unknown[],
  updateRows = [] as unknown[],
  deleteResult = undefined as unknown
} = {}) {
  // ── select chain ────────────────────────────────────────────────────────────
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(selectRows),
    limit: vi.fn().mockResolvedValue(selectRows)
  }
  const select = vi.fn(() => selectChain)

  // ── insert chain ────────────────────────────────────────────────────────────
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(insertRows),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined)
  }
  const insert = vi.fn(() => insertChain)

  // ── update chain ────────────────────────────────────────────────────────────
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(updateRows)
  }
  const update = vi.fn(() => updateChain)

  // ── delete chain ────────────────────────────────────────────────────────────
  const deleteChain = {
    where: vi.fn().mockResolvedValue(deleteResult)
  }
  const del = vi.fn(() => deleteChain)

  return {
    select,
    selectChain,
    insert,
    insertChain,
    update,
    updateChain,
    delete: del,
    deleteChain
  }
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('ModelService', () => {
  // Reset singleton between tests so each test starts clean.
  beforeEach(() => {
    vi.clearAllMocks()
    ;(ModelService as unknown as { instance: unknown }).instance = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── Singleton ─────────────────────────────────────────────────────────────

  describe('getInstance', () => {
    it('returns the same instance on repeated calls', () => {
      const a = ModelService.getInstance()
      const b = ModelService.getInstance()
      expect(a).toBe(b)
    })

    it('returns a ModelService instance', () => {
      expect(ModelService.getInstance()).toBeInstanceOf(ModelService)
    })
  })

  // ─── list ──────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns all models when no filters are provided', async () => {
      const rows = [
        makeDbRow({ modelId: 'gpt-4o', name: 'GPT-4o' }),
        makeDbRow({ modelId: 'gpt-4o-mini', name: 'GPT-4o Mini' })
      ]
      const mockDb = buildMockDb({ selectRows: rows })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      const result = await svc.list({})

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('openai::gpt-4o')
      expect(result[1].id).toBe('openai::gpt-4o-mini')
    })

    it('passes a providerId condition when query.providerId is set', async () => {
      const rows = [makeDbRow({ providerId: 'anthropic', modelId: 'claude-3' })]
      const mockDb = buildMockDb({ selectRows: rows })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      const result = await svc.list({ providerId: 'anthropic' })

      // The select chain's .where must have been called (not called with undefined)
      expect(mockDb.selectChain.where).toHaveBeenCalled()
      const [[whereArg]] = mockDb.selectChain.where.mock.calls
      expect(whereArg).toBeDefined()

      expect(result).toHaveLength(1)
      expect(result[0].providerId).toBe('anthropic')
    })

    it('passes an isEnabled condition when query.enabled is set', async () => {
      const rows = [makeDbRow({ isEnabled: true })]
      const mockDb = buildMockDb({ selectRows: rows })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await svc.list({ enabled: true })

      expect(mockDb.selectChain.where).toHaveBeenCalled()
      const [[whereArg]] = mockDb.selectChain.where.mock.calls
      expect(whereArg).toBeDefined()
    })

    it('calls .where with undefined when no filter conditions are set', async () => {
      const mockDb = buildMockDb({ selectRows: [] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await svc.list({})

      const [[whereArg]] = mockDb.selectChain.where.mock.calls
      expect(whereArg).toBeUndefined()
    })

    it('post-filters by capability after SQL query', async () => {
      const rows = [
        makeDbRow({ modelId: 'gpt-4o', capabilities: ['FUNCTION_CALL', 'REASONING'] }),
        makeDbRow({ modelId: 'embed-small', capabilities: ['EMBEDDING'] })
      ]
      const mockDb = buildMockDb({ selectRows: rows })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      const result = await svc.list({ capability: 'REASONING' })

      // Only the first row has REASONING
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('openai::gpt-4o')
    })

    it('returns empty array when capability filter matches no models', async () => {
      const rows = [makeDbRow({ capabilities: ['FUNCTION_CALL'] })]
      const mockDb = buildMockDb({ selectRows: rows })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      const result = await svc.list({ capability: 'EMBEDDING' })

      expect(result).toHaveLength(0)
    })

    it('returns empty array when DB returns no rows', async () => {
      const mockDb = buildMockDb({ selectRows: [] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      const result = await svc.list({})

      expect(result).toEqual([])
    })

    it('applies both providerId and enabled filters simultaneously', async () => {
      const rows = [makeDbRow({ providerId: 'openai', modelId: 'gpt-4o', isEnabled: true })]
      const mockDb = buildMockDb({ selectRows: rows })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      const result = await svc.list({ providerId: 'openai', enabled: true })

      expect(mockDb.selectChain.where).toHaveBeenCalled()
      const [[whereArg]] = mockDb.selectChain.where.mock.calls
      // and(...) with two conditions should produce a defined value
      expect(whereArg).toBeDefined()
      expect(result).toHaveLength(1)
    })
  })

  // ─── getByKey ──────────────────────────────────────────────────────────────

  describe('getByKey', () => {
    it('returns the model when the DB row exists', async () => {
      const row = makeDbRow({ providerId: 'openai', modelId: 'gpt-4o', name: 'GPT-4o' })
      const mockDb = buildMockDb({ selectRows: [row] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      const result = await svc.getByKey('openai', 'gpt-4o')

      expect(result.id).toBe('openai::gpt-4o')
      expect(result.name).toBe('GPT-4o')
      expect(result.providerId).toBe('openai')
    })

    it('calls .limit(1) on the query chain', async () => {
      const row = makeDbRow()
      const mockDb = buildMockDb({ selectRows: [row] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await svc.getByKey('openai', 'gpt-4o')

      expect(mockDb.selectChain.limit).toHaveBeenCalledWith(1)
    })

    it('throws a NOT_FOUND error when the DB returns no row', async () => {
      const mockDb = buildMockDb({ selectRows: [] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await expect(svc.getByKey('openai', 'nonexistent')).rejects.toThrow()
    })

    it('throws an error with NOT_FOUND code when model is missing', async () => {
      const mockDb = buildMockDb({ selectRows: [] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()

      let caughtError: unknown
      try {
        await svc.getByKey('openai', 'nonexistent')
      } catch (err) {
        caughtError = err
      }

      expect(caughtError).toBeDefined()
      // DataApiErrorFactory.notFound produces a DataApiError with NOT_FOUND code
      expect((caughtError as { code?: string }).code).toBe(ErrorCode.NOT_FOUND)
    })
  })

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('uses mergeModelConfig enrichment when catalog returns a preset model', async () => {
      const presetModel = makePresetModel()
      const catalogOverride = { providerId: 'openai', modelId: 'gpt-4o', priority: 0 }
      const mergedModel = makeMergedModel()
      const insertedRow = makeDbRow({
        name: mergedModel.name,
        capabilities: mergedModel.capabilities as string[]
      })

      vi.mocked(catalogService.lookupModel).mockReturnValue({
        presetModel: presetModel as any,
        catalogOverride
      })
      vi.mocked(mergeModelConfig).mockReturnValue(mergedModel as ReturnType<typeof mergeModelConfig>)

      const mockDb = buildMockDb({ insertRows: [insertedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      const result = await svc.create({ providerId: 'openai', modelId: 'gpt-4o' })

      // mergeModelConfig must have been called
      expect(mergeModelConfig).toHaveBeenCalledTimes(1)
      const [userRow, overrideArg, presetArg, providerIdArg] = vi.mocked(mergeModelConfig).mock.calls[0]
      expect(userRow).toMatchObject({ providerId: 'openai', modelId: 'gpt-4o' })
      expect(presetArg).toBe(presetModel)
      expect(overrideArg).toBe(catalogOverride)
      expect(providerIdArg).toBe('openai')

      // The returned model should reflect the inserted row
      expect(result.id).toBe('openai::gpt-4o')
    })

    it('sets presetModelId from presetModel.id when catalog match is found', async () => {
      const presetModel = makePresetModel({ id: 'gpt-4o' })
      const mergedModel = makeMergedModel()
      const insertedRow = makeDbRow({ presetModelId: 'gpt-4o' })

      vi.mocked(catalogService.lookupModel).mockReturnValue({
        presetModel: presetModel as any,
        catalogOverride: null
      })
      vi.mocked(mergeModelConfig).mockReturnValue(mergedModel as ReturnType<typeof mergeModelConfig>)

      const mockDb = buildMockDb({ insertRows: [insertedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await svc.create({ providerId: 'openai', modelId: 'gpt-4o' })

      // Verify insert was called with presetModelId set
      expect(mockDb.insertChain.values).toHaveBeenCalledTimes(1)
      const [insertValues] = vi.mocked(mockDb.insertChain.values).mock.calls[0]
      expect((insertValues as { presetModelId: string }).presetModelId).toBe('gpt-4o')
    })

    it('uses catalogOverride.apiModelId for modelApiId when available', async () => {
      const presetModel = makePresetModel()
      const catalogOverride = { providerId: 'openai', modelId: 'gpt-4o', apiModelId: 'gpt-4o-2024', priority: 0 }
      const mergedModel = makeMergedModel()
      const insertedRow = makeDbRow({ modelApiId: 'gpt-4o-2024' })

      vi.mocked(catalogService.lookupModel).mockReturnValue({
        presetModel: presetModel as any,
        catalogOverride
      })
      vi.mocked(mergeModelConfig).mockReturnValue(mergedModel as ReturnType<typeof mergeModelConfig>)

      const mockDb = buildMockDb({ insertRows: [insertedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await svc.create({ providerId: 'openai', modelId: 'gpt-4o' })

      const [insertValues] = vi.mocked(mockDb.insertChain.values).mock.calls[0]
      expect((insertValues as { modelApiId: string }).modelApiId).toBe('gpt-4o-2024')
    })

    it('sets modelApiId to null when catalogOverride has no apiModelId', async () => {
      const presetModel = makePresetModel()
      const catalogOverride = { providerId: 'openai', modelId: 'gpt-4o', priority: 0 }
      const mergedModel = makeMergedModel()
      const insertedRow = makeDbRow({ modelApiId: null })

      vi.mocked(catalogService.lookupModel).mockReturnValue({
        presetModel: presetModel as any,
        catalogOverride
      })
      vi.mocked(mergeModelConfig).mockReturnValue(mergedModel as ReturnType<typeof mergeModelConfig>)

      const mockDb = buildMockDb({ insertRows: [insertedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await svc.create({ providerId: 'openai', modelId: 'gpt-4o' })

      const [insertValues] = vi.mocked(mockDb.insertChain.values).mock.calls[0]
      expect((insertValues as { modelApiId: null }).modelApiId).toBeNull()
    })

    it('saves a custom model (no catalog match) without calling mergeModelConfig', async () => {
      vi.mocked(catalogService.lookupModel).mockReturnValue({
        presetModel: null,
        catalogOverride: null
      })

      const insertedRow = makeDbRow({
        providerId: 'my-provider',
        modelId: 'custom-llm',
        name: 'Custom LLM',
        presetModelId: null
      })
      const mockDb = buildMockDb({ insertRows: [insertedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      const result = await svc.create({
        providerId: 'my-provider',
        modelId: 'custom-llm',
        name: 'Custom LLM'
      })

      expect(mergeModelConfig).not.toHaveBeenCalled()
      expect(result.id).toBe('my-provider::custom-llm')
      expect(result.name).toBe('Custom LLM')
    })

    it('carries DTO fields through to the insert values for custom models', async () => {
      vi.mocked(catalogService.lookupModel).mockReturnValue({
        presetModel: null,
        catalogOverride: null
      })

      const insertedRow = makeDbRow({
        providerId: 'custom',
        modelId: 'my-model',
        capabilities: ['EMBEDDING'],
        contextWindow: 8192,
        supportsStreaming: false
      })
      const mockDb = buildMockDb({ insertRows: [insertedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await svc.create({
        providerId: 'custom',
        modelId: 'my-model',
        capabilities: ['EMBEDDING'],
        contextWindow: 8192,
        supportsStreaming: false
      })

      const [insertValues] = vi.mocked(mockDb.insertChain.values).mock.calls[0]
      const v = insertValues as Record<string, unknown>
      expect(v.capabilities).toEqual(['EMBEDDING'])
      expect(v.contextWindow).toBe(8192)
      expect(v.supportsStreaming).toBe(false)
    })

    it('uses dto.presetModelId for presetModelId when no catalog match exists', async () => {
      vi.mocked(catalogService.lookupModel).mockReturnValue({
        presetModel: null,
        catalogOverride: null
      })

      const insertedRow = makeDbRow({ presetModelId: 'some-preset' })
      const mockDb = buildMockDb({ insertRows: [insertedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await svc.create({
        providerId: 'openai',
        modelId: 'gpt-5',
        presetModelId: 'some-preset'
      })

      const [insertValues] = vi.mocked(mockDb.insertChain.values).mock.calls[0]
      expect((insertValues as { presetModelId: string }).presetModelId).toBe('some-preset')
    })

    it('returns the mapped model from the inserted row', async () => {
      vi.mocked(catalogService.lookupModel).mockReturnValue({
        presetModel: null,
        catalogOverride: null
      })

      const insertedRow = makeDbRow({
        providerId: 'openai',
        modelId: 'gpt-5',
        name: 'GPT-5',
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      })
      const mockDb = buildMockDb({ insertRows: [insertedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      const result = await svc.create({ providerId: 'openai', modelId: 'gpt-5', name: 'GPT-5' })

      expect(result.id).toBe('openai::gpt-5')
      expect(result.name).toBe('GPT-5')
      expect(result.supportsStreaming).toBe(true)
      expect(result.isEnabled).toBe(true)
      expect(result.isHidden).toBe(false)
    })

    it('carries all optional DTO fields through for custom models', async () => {
      vi.mocked(catalogService.lookupModel).mockReturnValue({
        presetModel: null,
        catalogOverride: null
      })

      const insertedRow = makeDbRow({
        providerId: 'custom',
        modelId: 'full-model',
        description: 'A full model',
        group: 'Custom Group',
        capabilities: ['FUNCTION_CALL'],
        inputModalities: ['TEXT', 'IMAGE'],
        outputModalities: ['TEXT'],
        endpointTypes: ['chat'],
        contextWindow: 32768,
        maxOutputTokens: 4096,
        supportsStreaming: true,
        reasoning: { type: 'enabled', budgetToken: 1024 },
        parameters: { temperature: { min: 0, max: 2, default: 1 } },
        pricing: { inputTokens: 0.01, outputTokens: 0.03 }
      })
      const mockDb = buildMockDb({ insertRows: [insertedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await svc.create({
        providerId: 'custom',
        modelId: 'full-model',
        description: 'A full model',
        group: 'Custom Group',
        capabilities: ['FUNCTION_CALL'],
        inputModalities: ['TEXT', 'IMAGE'],
        outputModalities: ['TEXT'],
        endpointTypes: ['chat'],
        contextWindow: 32768,
        maxOutputTokens: 4096,
        supportsStreaming: true,
        reasoning: { type: 'enabled', budgetToken: 1024 } as any,
        parameters: { temperature: { min: 0, max: 2, default: 1 } } as any,
        pricing: { inputTokens: 0.01, outputTokens: 0.03 } as any
      })

      const [insertValues] = vi.mocked(mockDb.insertChain.values).mock.calls[0]
      const v = insertValues as Record<string, unknown>
      expect(v.description).toBe('A full model')
      expect(v.group).toBe('Custom Group')
      expect(v.inputModalities).toEqual(['TEXT', 'IMAGE'])
      expect(v.outputModalities).toEqual(['TEXT'])
      expect(v.endpointTypes).toEqual(['chat'])
      expect(v.maxOutputTokens).toBe(4096)
      expect(v.reasoning).toEqual({ type: 'enabled', budgetToken: 1024 })
      expect(v.parameters).toEqual({ temperature: { min: 0, max: 2, default: 1 } })
      expect(v.pricing).toEqual({ inputTokens: 0.01, outputTokens: 0.03 })
    })

    it('passes optional DTO fields into userRow for catalog-match path', async () => {
      const presetModel = makePresetModel()
      const catalogOverride = { providerId: 'openai', modelId: 'gpt-4o', priority: 0 }
      const mergedModel = makeMergedModel()

      vi.mocked(catalogService.lookupModel).mockReturnValue({
        presetModel: presetModel as any,
        catalogOverride
      })
      vi.mocked(mergeModelConfig).mockReturnValue(mergedModel as ReturnType<typeof mergeModelConfig>)

      const insertedRow = makeDbRow()
      const mockDb = buildMockDb({ insertRows: [insertedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await svc.create({
        providerId: 'openai',
        modelId: 'gpt-4o',
        name: 'My Custom Name',
        description: 'Custom desc',
        group: 'My Group',
        capabilities: ['REASONING'],
        contextWindow: 64000,
        supportsStreaming: false
      })

      // Verify mergeModelConfig received the user overrides
      const [userRow] = vi.mocked(mergeModelConfig).mock.calls[0]
      const u = userRow as Record<string, unknown>
      expect(u.name).toBe('My Custom Name')
      expect(u.description).toBe('Custom desc')
      expect(u.group).toBe('My Group')
      expect(u.capabilities).toEqual(['REASONING'])
      expect(u.contextWindow).toBe(64000)
      expect(u.supportsStreaming).toBe(false)
    })

    it('uses mergeModelConfig output fields for insert values in catalog path', async () => {
      const presetModel = makePresetModel()
      const catalogOverride = { providerId: 'openai', modelId: 'gpt-4o', priority: 0 }
      const mergedModel = {
        ...makeMergedModel(),
        description: 'Merged description',
        group: 'Merged Group',
        inputModalities: ['TEXT', 'VISION'],
        outputModalities: ['TEXT'],
        endpointTypes: ['chat'],
        contextWindow: 200000,
        maxOutputTokens: 8192,
        reasoning: { type: 'enabled', budgetToken: 2048 },
        parameters: { temperature: { min: 0, max: 2, default: 0.7 } },
        pricing: { inputTokens: 0.005, outputTokens: 0.015 }
      }

      vi.mocked(catalogService.lookupModel).mockReturnValue({
        presetModel: presetModel as any,
        catalogOverride
      })
      vi.mocked(mergeModelConfig).mockReturnValue(mergedModel as unknown as ReturnType<typeof mergeModelConfig>)

      const insertedRow = makeDbRow()
      const mockDb = buildMockDb({ insertRows: [insertedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await svc.create({ providerId: 'openai', modelId: 'gpt-4o' })

      const [insertValues] = vi.mocked(mockDb.insertChain.values).mock.calls[0]
      const v = insertValues as Record<string, unknown>
      expect(v.description).toBe('Merged description')
      expect(v.group).toBe('Merged Group')
      expect(v.inputModalities).toEqual(['TEXT', 'VISION'])
      expect(v.outputModalities).toEqual(['TEXT'])
      expect(v.endpointTypes).toEqual(['chat'])
      expect(v.contextWindow).toBe(200000)
      expect(v.maxOutputTokens).toBe(8192)
      expect(v.reasoning).toEqual({ type: 'enabled', budgetToken: 2048 })
      expect(v.parameters).toEqual({ temperature: { min: 0, max: 2, default: 0.7 } })
      expect(v.pricing).toEqual({ inputTokens: 0.005, outputTokens: 0.015 })
    })
  })

  // ─── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates and returns the model when it exists', async () => {
      const existingRow = makeDbRow({ name: 'Old Name' })
      const updatedRow = makeDbRow({ name: 'New Name' })

      const mockDb = buildMockDb({
        // First call (getByKey select) returns existing row
        selectRows: [existingRow],
        updateRows: [updatedRow]
      })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      const result = await svc.update('openai', 'gpt-4o', { name: 'New Name' })

      expect(result.name).toBe('New Name')
    })

    it('calls db.update with only the fields that are present in the DTO', async () => {
      const existingRow = makeDbRow()
      const updatedRow = makeDbRow({ isEnabled: false })

      const mockDb = buildMockDb({ selectRows: [existingRow], updateRows: [updatedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await svc.update('openai', 'gpt-4o', { isEnabled: false })

      expect(mockDb.updateChain.set).toHaveBeenCalledTimes(1)
      const [setArg] = vi.mocked(mockDb.updateChain.set).mock.calls[0]
      const updates = setArg as Record<string, unknown>
      expect(updates.isEnabled).toBe(false)
      // Fields not in the DTO should not be present
      expect(updates).not.toHaveProperty('name')
      expect(updates).not.toHaveProperty('contextWindow')
    })

    it('includes all provided DTO fields in the update set', async () => {
      const existingRow = makeDbRow()
      const updatedRow = makeDbRow({
        name: 'Renamed',
        contextWindow: 64_000,
        isHidden: true,
        sortOrder: 5,
        notes: 'my notes'
      })

      const mockDb = buildMockDb({ selectRows: [existingRow], updateRows: [updatedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await svc.update('openai', 'gpt-4o', {
        name: 'Renamed',
        contextWindow: 64_000,
        isHidden: true,
        sortOrder: 5,
        notes: 'my notes'
      })

      const [setArg] = vi.mocked(mockDb.updateChain.set).mock.calls[0]
      const updates = setArg as Record<string, unknown>
      expect(updates.name).toBe('Renamed')
      expect(updates.contextWindow).toBe(64_000)
      expect(updates.isHidden).toBe(true)
      expect(updates.sortOrder).toBe(5)
      expect(updates.notes).toBe('my notes')
    })

    it('throws NOT_FOUND when the model does not exist', async () => {
      // getByKey internally queries the DB; returning no row triggers notFound
      const mockDb = buildMockDb({ selectRows: [] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      let caughtError: unknown
      try {
        await svc.update('openai', 'nonexistent', { name: 'New Name' })
      } catch (err) {
        caughtError = err
      }

      expect(caughtError).toBeDefined()
      expect((caughtError as { code?: string }).code).toBe(ErrorCode.NOT_FOUND)
    })

    it('does not call db.update when the model is not found', async () => {
      const mockDb = buildMockDb({ selectRows: [] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      try {
        await svc.update('openai', 'nonexistent', { name: 'x' })
      } catch {
        // expected
      }

      expect(mockDb.update).not.toHaveBeenCalled()
    })

    it('includes all remaining DTO fields in the update set', async () => {
      const existingRow = makeDbRow()
      const updatedRow = makeDbRow({
        description: 'Updated desc',
        group: 'New Group',
        capabilities: ['REASONING', 'FUNCTION_CALL'],
        endpointTypes: ['chat', 'completion'],
        supportsStreaming: false,
        maxOutputTokens: 8192,
        reasoning: { type: 'enabled', budgetToken: 4096 },
        pricing: { inputTokens: 0.01, outputTokens: 0.03 }
      })

      const mockDb = buildMockDb({ selectRows: [existingRow], updateRows: [updatedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await svc.update('openai', 'gpt-4o', {
        description: 'Updated desc',
        group: 'New Group',
        capabilities: ['REASONING', 'FUNCTION_CALL'],
        endpointTypes: ['chat', 'completion'],
        supportsStreaming: false,
        maxOutputTokens: 8192,
        reasoning: { type: 'enabled', budgetToken: 4096 } as any,
        pricing: { inputTokens: 0.01, outputTokens: 0.03 } as any
      })

      const [setArg] = vi.mocked(mockDb.updateChain.set).mock.calls[0]
      const updates = setArg as Record<string, unknown>
      expect(updates.description).toBe('Updated desc')
      expect(updates.group).toBe('New Group')
      expect(updates.capabilities).toEqual(['REASONING', 'FUNCTION_CALL'])
      expect(updates.endpointTypes).toEqual(['chat', 'completion'])
      expect(updates.supportsStreaming).toBe(false)
      expect(updates.maxOutputTokens).toBe(8192)
      expect(updates.reasoning).toEqual({ type: 'enabled', budgetToken: 4096 })
      expect(updates.pricing).toEqual({ inputTokens: 0.01, outputTokens: 0.03 })
    })

    it('handles empty DTO update without errors', async () => {
      const existingRow = makeDbRow()
      const updatedRow = makeDbRow()

      const mockDb = buildMockDb({ selectRows: [existingRow], updateRows: [updatedRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      const result = await svc.update('openai', 'gpt-4o', {})

      expect(result).toBeDefined()
      const [setArg] = vi.mocked(mockDb.updateChain.set).mock.calls[0]
      expect(Object.keys(setArg as object)).toHaveLength(0)
    })
  })

  // ─── delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes the model when it exists and resolves without error', async () => {
      const existingRow = makeDbRow()
      const mockDb = buildMockDb({ selectRows: [existingRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await expect(svc.delete('openai', 'gpt-4o')).resolves.toBeUndefined()
    })

    it('calls db.delete with a where clause matching the composite key', async () => {
      const existingRow = makeDbRow()
      const mockDb = buildMockDb({ selectRows: [existingRow] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await svc.delete('openai', 'gpt-4o')

      expect(mockDb.delete).toHaveBeenCalledTimes(1)
      expect(mockDb.deleteChain.where).toHaveBeenCalledTimes(1)
      // Verify the where call received a condition (not undefined)
      const [[whereArg]] = mockDb.deleteChain.where.mock.calls
      expect(whereArg).toBeDefined()
    })

    it('throws NOT_FOUND when the model does not exist', async () => {
      const mockDb = buildMockDb({ selectRows: [] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      let caughtError: unknown
      try {
        await svc.delete('openai', 'nonexistent')
      } catch (err) {
        caughtError = err
      }

      expect(caughtError).toBeDefined()
      expect((caughtError as { code?: string }).code).toBe(ErrorCode.NOT_FOUND)
    })

    it('does not call db.delete when the model is not found', async () => {
      const mockDb = buildMockDb({ selectRows: [] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      try {
        await svc.delete('openai', 'nonexistent')
      } catch {
        // expected
      }

      expect(mockDb.delete).not.toHaveBeenCalled()
    })
  })

  // ─── batchUpsert ───────────────────────────────────────────────────────────

  describe('batchUpsert', () => {
    it('returns immediately without touching the DB when given an empty array', async () => {
      const mockDb = buildMockDb()
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      await svc.batchUpsert([])

      expect(dbService.getDb).not.toHaveBeenCalled()
      expect(mockDb.insert).not.toHaveBeenCalled()
    })

    it('calls db.insert for each model in the batch', async () => {
      const mockDb = buildMockDb()
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const models = [
        makeDbRow({ modelId: 'gpt-4o' }),
        makeDbRow({ modelId: 'gpt-4o-mini' }),
        makeDbRow({ modelId: 'o1' })
      ]

      const svc = ModelService.getInstance()
      await svc.batchUpsert(models)

      expect(mockDb.insert).toHaveBeenCalledTimes(3)
    })

    it('uses onConflictDoUpdate on each insert', async () => {
      const mockDb = buildMockDb()
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const models = [makeDbRow({ modelId: 'gpt-4o' }), makeDbRow({ modelId: 'gpt-4o-mini' })]

      const svc = ModelService.getInstance()
      await svc.batchUpsert(models)

      expect(mockDb.insertChain.onConflictDoUpdate).toHaveBeenCalledTimes(2)
    })

    it('passes the correct model fields to each insert', async () => {
      const mockDb = buildMockDb()
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const model = makeDbRow({
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet',
        name: 'Claude 3.5 Sonnet',
        capabilities: ['FUNCTION_CALL', 'REASONING']
      })

      const svc = ModelService.getInstance()
      await svc.batchUpsert([model])

      const [[insertValues]] = vi.mocked(mockDb.insertChain.values).mock.calls
      const v = insertValues as Record<string, unknown>
      expect(v.providerId).toBe('anthropic')
      expect(v.modelId).toBe('claude-3-5-sonnet')
    })

    it('passes the conflict update set with expected fields to onConflictDoUpdate', async () => {
      const mockDb = buildMockDb()
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const model = makeDbRow({
        modelId: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: ['FUNCTION_CALL'],
        contextWindow: 128_000
      })

      const svc = ModelService.getInstance()
      await svc.batchUpsert([model])

      const [[conflictArg]] = vi.mocked(mockDb.insertChain.onConflictDoUpdate).mock.calls
      const { set } = conflictArg as { set: Record<string, unknown> }
      // Only catalog-sourced fields should be in the conflict update
      expect(set).toHaveProperty('name')
      expect(set).toHaveProperty('capabilities')
      expect(set).toHaveProperty('contextWindow')
      expect(set).toHaveProperty('supportsStreaming')
      // User-managed fields like isEnabled should NOT be overwritten
      expect(set).not.toHaveProperty('isEnabled')
      expect(set).not.toHaveProperty('isHidden')
    })

    it('onConflictDoUpdate set excludes sortOrder, notes, modelApiId, and id', async () => {
      const mockDb = buildMockDb()
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const model = makeDbRow({ modelId: 'gpt-4o', sortOrder: 5, notes: 'my notes' })
      const svc = ModelService.getInstance()
      await svc.batchUpsert([model])

      const [[conflictArg]] = vi.mocked(mockDb.insertChain.onConflictDoUpdate).mock.calls
      const { set } = conflictArg as { set: Record<string, unknown> }
      expect(set).not.toHaveProperty('sortOrder')
      expect(set).not.toHaveProperty('notes')
      expect(set).not.toHaveProperty('modelApiId')
      expect(set).not.toHaveProperty('id')
      expect(set).not.toHaveProperty('customEndpointUrl')
    })
  })

  // ─── rowToRuntimeModel (via list / getByKey) ───────────────────────────────

  describe('rowToRuntimeModel field mapping', () => {
    async function getModelFromRow(rowOverrides: Record<string, unknown>) {
      const row = makeDbRow(rowOverrides)
      const mockDb = buildMockDb({ selectRows: [row] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)
      const svc = ModelService.getInstance()
      const [model] = await svc.list({})
      return model
    }

    it('constructs id as "providerId::modelId"', async () => {
      const model = await getModelFromRow({ providerId: 'mistral', modelId: 'mistral-large' })
      expect(model.id).toBe('mistral::mistral-large')
    })

    it('uses modelApiId from row when present', async () => {
      const model = await getModelFromRow({ modelApiId: 'gpt-4o-2024-11-20' })
      expect(model.apiModelId).toBe('gpt-4o-2024-11-20')
    })

    it('falls back apiModelId to modelId when modelApiId is null', async () => {
      const model = await getModelFromRow({ modelId: 'gpt-4o', modelApiId: null })
      expect(model.apiModelId).toBe('gpt-4o')
    })

    it('uses name from row when present', async () => {
      const model = await getModelFromRow({ name: 'My Model Name' })
      expect(model.name).toBe('My Model Name')
    })

    it('falls back name to modelId when name is null', async () => {
      const model = await getModelFromRow({ modelId: 'some-model-id', name: null })
      expect(model.name).toBe('some-model-id')
    })

    it('maps description to undefined when null in DB', async () => {
      const model = await getModelFromRow({ description: null })
      expect(model.description).toBeUndefined()
    })

    it('maps description to string value when present', async () => {
      const model = await getModelFromRow({ description: 'A powerful model' })
      expect(model.description).toBe('A powerful model')
    })

    it('casts capabilities to ModelCapability array', async () => {
      const model = await getModelFromRow({ capabilities: ['FUNCTION_CALL', 'REASONING'] })
      expect(model.capabilities).toEqual(['FUNCTION_CALL', 'REASONING'])
    })

    it('defaults capabilities to empty array when null in DB', async () => {
      const model = await getModelFromRow({ capabilities: null })
      expect(model.capabilities).toEqual([])
    })

    it('maps inputModalities to undefined when null in DB', async () => {
      const model = await getModelFromRow({ inputModalities: null })
      expect(model.inputModalities).toBeUndefined()
    })

    it('maps inputModalities when set', async () => {
      const model = await getModelFromRow({ inputModalities: ['TEXT', 'IMAGE'] })
      expect(model.inputModalities).toEqual(['TEXT', 'IMAGE'])
    })

    it('maps outputModalities to undefined when null in DB', async () => {
      const model = await getModelFromRow({ outputModalities: null })
      expect(model.outputModalities).toBeUndefined()
    })

    it('maps contextWindow to undefined when null in DB', async () => {
      const model = await getModelFromRow({ contextWindow: null })
      expect(model.contextWindow).toBeUndefined()
    })

    it('maps contextWindow to number when set', async () => {
      const model = await getModelFromRow({ contextWindow: 32_768 })
      expect(model.contextWindow).toBe(32_768)
    })

    it('maps maxOutputTokens to undefined when null in DB', async () => {
      const model = await getModelFromRow({ maxOutputTokens: null })
      expect(model.maxOutputTokens).toBeUndefined()
    })

    it('maps endpointTypes to undefined when null in DB', async () => {
      const model = await getModelFromRow({ endpointTypes: null })
      expect(model.endpointTypes).toBeUndefined()
    })

    it('defaults supportsStreaming to true when null in DB', async () => {
      const model = await getModelFromRow({ supportsStreaming: null })
      expect(model.supportsStreaming).toBe(true)
    })

    it('maps supportsStreaming false when explicitly false in DB', async () => {
      const model = await getModelFromRow({ supportsStreaming: false })
      expect(model.supportsStreaming).toBe(false)
    })

    it('maps reasoning to undefined when null in DB', async () => {
      const model = await getModelFromRow({ reasoning: null })
      expect(model.reasoning).toBeUndefined()
    })

    it('maps pricing to undefined when null in DB', async () => {
      const model = await getModelFromRow({ pricing: null })
      expect(model.pricing).toBeUndefined()
    })

    it('defaults isEnabled to true when null in DB', async () => {
      const model = await getModelFromRow({ isEnabled: null })
      expect(model.isEnabled).toBe(true)
    })

    it('maps isEnabled false when explicitly false in DB', async () => {
      const model = await getModelFromRow({ isEnabled: false })
      expect(model.isEnabled).toBe(false)
    })

    it('defaults isHidden to false when null in DB', async () => {
      const model = await getModelFromRow({ isHidden: null })
      expect(model.isHidden).toBe(false)
    })

    it('maps isHidden true when explicitly true in DB', async () => {
      const model = await getModelFromRow({ isHidden: true })
      expect(model.isHidden).toBe(true)
    })

    it('does not include a replaceWith field (not in DB schema)', async () => {
      const model = await getModelFromRow({})
      expect(model).not.toHaveProperty('replaceWith')
    })

    it('maps group to string value when present', async () => {
      const model = await getModelFromRow({ group: 'GPT Series' })
      expect(model.group).toBe('GPT Series')
    })

    it('maps outputModalities when set', async () => {
      const model = await getModelFromRow({ outputModalities: ['TEXT', 'IMAGE'] })
      expect(model.outputModalities).toEqual(['TEXT', 'IMAGE'])
    })

    it('maps maxOutputTokens to number when set', async () => {
      const model = await getModelFromRow({ maxOutputTokens: 4096 })
      expect(model.maxOutputTokens).toBe(4096)
    })

    it('maps endpointTypes when set', async () => {
      const model = await getModelFromRow({ endpointTypes: ['chat', 'completion'] })
      expect(model.endpointTypes).toEqual(['chat', 'completion'])
    })

    it('maps reasoning when set', async () => {
      const reasoningConfig = { type: 'enabled', budgetToken: 1024 }
      const model = await getModelFromRow({ reasoning: reasoningConfig })
      expect(model.reasoning).toEqual(reasoningConfig)
    })

    it('maps parameters to undefined when null in DB', async () => {
      const model = await getModelFromRow({ parameters: null })
      expect(model.parameters).toBeUndefined()
    })

    it('maps parameters when set', async () => {
      const params = { temperature: { min: 0, max: 2, default: 1 } }
      const model = await getModelFromRow({ parameters: params })
      expect(model.parameters).toEqual(params)
    })

    it('maps pricing when set', async () => {
      const pricing = { inputTokens: 0.01, outputTokens: 0.03 }
      const model = await getModelFromRow({ pricing: pricing })
      expect(model.pricing).toEqual(pricing)
    })
  })

  // ─── DataApiErrorFactory integration ──────────────────────────────────────

  describe('DataApiErrorFactory.notFound', () => {
    it('produces an error with the resource name in its message', async () => {
      const mockDb = buildMockDb({ selectRows: [] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      let caughtError: unknown
      try {
        await svc.getByKey('openai', 'missing-model')
      } catch (err) {
        caughtError = err
      }

      expect((caughtError as Error).message).toContain('Model')
    })

    it('produces an error that includes the composite key in its message', async () => {
      const mockDb = buildMockDb({ selectRows: [] })
      vi.mocked(dbService.getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof dbService.getDb>)

      const svc = ModelService.getInstance()
      let caughtError: unknown
      try {
        await svc.getByKey('openai', 'missing-model')
      } catch (err) {
        caughtError = err
      }

      expect((caughtError as Error).message).toContain('openai/missing-model')
    })
  })
})
