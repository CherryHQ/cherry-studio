/**
 * Tests for ModelService — field mapping, update behavior, and create merge logic.
 * Uses the unified mock system per CLAUDE.md testing guidelines.
 */

import type { UpdateModelDto } from '@shared/data/api/schemas/models'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UPDATE_MODEL_FIELD_MAP } from '../ModelService'

// ─────────────────────────────────────────────────────────────────────────────
// DB mock that captures insert/update arguments
// ─────────────────────────────────────────────────────────────────────────────

let capturedInsertValues: unknown = null
let capturedUpdateSet: unknown = null

function createCapturingMockDb(selectResults: unknown[][] = [[]]) {
  let selectCallIndex = 0

  const makeChainable = (): unknown => {
    const obj: Record<string, unknown> = {}

    for (const method of ['from', 'where', 'limit', 'onConflictDoUpdate', 'all', 'get', 'returning']) {
      obj[method] = vi.fn(() => makeChainable())
    }

    obj.select = vi.fn(() => makeChainable())

    obj.insert = vi.fn(() => {
      const insertChain: Record<string, unknown> = {}
      insertChain.values = vi.fn((vals: unknown) => {
        capturedInsertValues = vals
        const returnChain: Record<string, unknown> = {}
        returnChain.returning = vi.fn(() => {
          const thenable: Record<string, unknown> = {}
          thenable.then = (resolve: (v: unknown) => void) =>
            resolve(Array.isArray(capturedInsertValues) ? capturedInsertValues : [capturedInsertValues])
          return thenable
        })
        returnChain.onConflictDoUpdate = vi.fn(() => returnChain)
        returnChain.then = (resolve: (v: unknown) => void) =>
          resolve(Array.isArray(capturedInsertValues) ? capturedInsertValues : [capturedInsertValues])
        return returnChain
      })
      return insertChain
    })

    obj.update = vi.fn(() => {
      const updateChain: Record<string, unknown> = {}
      updateChain.set = vi.fn((vals: unknown) => {
        capturedUpdateSet = vals
        const setChain: Record<string, unknown> = {}
        setChain.where = vi.fn(() => {
          const whereChain: Record<string, unknown> = {}
          whereChain.returning = vi.fn(() => {
            const thenable: Record<string, unknown> = {}
            thenable.then = (resolve: (v: unknown) => void) =>
              resolve([{ ...(selectResults[0]?.[0] as object), ...(capturedUpdateSet as object) }])
            return thenable
          })
          return whereChain
        })
        return setChain
      })
      return updateChain
    })

    obj.transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeChainable()))
    obj.then = (resolve: (v: unknown) => void) => {
      const result = selectResults[selectCallIndex] ?? []
      selectCallIndex++
      resolve(result)
    }

    return obj
  }

  return makeChainable()
}

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('../ProviderRegistryService', () => ({
  providerRegistryService: {}
}))

const { modelService } = await import('../ModelService')

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
  const existingRow = {
    providerId: 'openai',
    modelId: 'gpt-4o',
    presetModelId: 'gpt-4o',
    name: 'GPT-4o',
    description: null,
    group: null,
    capabilities: ['function-call'],
    inputModalities: ['text'],
    outputModalities: ['text'],
    endpointTypes: null,
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    supportsStreaming: true,
    reasoning: null,
    parameters: null,
    pricing: null,
    isEnabled: true,
    isHidden: false,
    sortOrder: 0,
    notes: null,
    userOverrides: null,
    customEndpointUrl: null,
    isDeprecated: false,
    createdAt: null,
    updatedAt: null
  }

  beforeEach(() => {
    capturedUpdateSet = null
    MockMainDbServiceUtils.setDb(createCapturingMockDb([[existingRow]]))
  })

  it('only writes provided fields — partial update does not clear others', async () => {
    await modelService.update('openai', 'gpt-4o', { name: 'New Name' })

    const set = capturedUpdateSet as Record<string, unknown>
    expect(set.name).toBe('New Name')
    expect(set.description).toBeUndefined()
    expect(set.capabilities).toBeUndefined()
    expect(set.contextWindow).toBeUndefined()
  })

  it('parameterSupport DTO key maps to parameters DB column', async () => {
    const params = { temperature: { supported: true } } as any
    await modelService.update('openai', 'gpt-4o', { parameterSupport: params })

    const set = capturedUpdateSet as Record<string, unknown>
    expect(set.parameters).toEqual(params)
    expect(set.parameterSupport).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ModelService.create — merge behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('ModelService.create', () => {
  beforeEach(() => {
    capturedInsertValues = null
    MockMainDbServiceUtils.setDb(createCapturingMockDb())
  })

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

    await modelService.create(dto, registryData)

    const vals = capturedInsertValues as Record<string, unknown>
    expect(vals.name).toBe('GPT-4o')
    expect(vals.capabilities).toEqual(['function-call'])
    expect(vals.contextWindow).toBe(128_000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ModelService.batchCreate — batch insert with create semantics
// ─────────────────────────────────────────────────────────────────────────────

describe('ModelService.batchCreate', () => {
  beforeEach(() => {
    capturedInsertValues = null
    MockMainDbServiceUtils.setDb(createCapturingMockDb())
  })

  it('builds all rows with the same registry-aware merge semantics as create', async () => {
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

    await modelService.batchCreate(batch as any)

    const vals = capturedInsertValues as Array<Record<string, unknown>>
    expect(vals).toHaveLength(2)
    expect(vals[0]).toMatchObject({
      providerId: 'openai',
      modelId: 'gpt-4o',
      presetModelId: 'gpt-4o',
      name: 'GPT-4o',
      capabilities: ['function-call'],
      contextWindow: 128_000
    })
    expect(vals[1]).toMatchObject({
      providerId: 'custom',
      modelId: 'my-model',
      presetModelId: null,
      name: 'My Model',
      endpointTypes: ['openai']
    })
  })
})
