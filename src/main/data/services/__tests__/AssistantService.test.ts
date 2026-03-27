import { DataApiError, ErrorCode } from '@shared/data/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AssistantDataService, assistantDataService } from '../AssistantService'

// ============================================================================
// DB Mock Helpers
// ============================================================================

function createMockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ast-1',
    name: 'test-assistant',
    prompt: 'You are helpful',
    emoji: null,
    description: null,
    settings: null,
    mcpMode: null,
    enableWebSearch: false,
    enableMemory: false,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    deletedAt: null,
    ...overrides
  }
}

/**
 * Creates a chainable mock that resolves to the given value when awaited.
 * Every method call on the chain returns the same chain, so
 * db.select().from().where().limit() all work.
 */
function mockChain(resolvedValue: unknown) {
  const thenable = {
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      return Promise.resolve(resolvedValue).then(resolve, reject)
    }
  }

  const chain: any = new Proxy(thenable, {
    get(target, prop) {
      if (prop === 'then') return target.then
      if (prop === 'catch' || prop === 'finally') {
        return (...args: unknown[]) => Promise.resolve(resolvedValue)[prop as 'catch'](...(args as [any]))
      }
      // Any method call returns the chain itself
      return () => chain
    }
  })

  return chain
}

let mockDb: any

vi.mock('@main/core/application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    DbService: { getDb: () => mockDb }
  })
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

// ============================================================================
// Tests
// ============================================================================

describe('AssistantDataService', () => {
  beforeEach(() => {
    mockDb = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      transaction: vi.fn()
    }
  })

  it('should export a module-level singleton', () => {
    expect(assistantDataService).toBeInstanceOf(AssistantDataService)
  })

  // --------------------------------------------------------------------------
  // getById
  // --------------------------------------------------------------------------
  describe('getById', () => {
    it('should return an assistant when found', async () => {
      const row = createMockRow()
      mockDb.select.mockReturnValue(mockChain([row]))

      const result = await assistantDataService.getById('ast-1')
      expect(result.id).toBe('ast-1')
      expect(result.name).toBe('test-assistant')
      expect(typeof result.createdAt).toBe('string')
    })

    it('should throw NOT_FOUND when assistant does not exist', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      await expect(assistantDataService.getById('non-existent')).rejects.toThrow(DataApiError)
      await expect(assistantDataService.getById('non-existent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  // --------------------------------------------------------------------------
  // list
  // --------------------------------------------------------------------------
  describe('list', () => {
    it('should return all assistants when no filters', async () => {
      const rows = [createMockRow(), createMockRow({ id: 'ast-2', name: 'second' })]
      mockDb.select.mockReturnValueOnce(mockChain(rows)).mockReturnValueOnce(mockChain([{ count: 2 }]))

      const result = await assistantDataService.list({})
      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(2)
    })

    it('should filter by id', async () => {
      const rows = [createMockRow()]
      mockDb.select.mockReturnValueOnce(mockChain(rows)).mockReturnValueOnce(mockChain([{ count: 1 }]))

      const result = await assistantDataService.list({ id: 'ast-1' })
      expect(result.items).toHaveLength(1)
    })
  })

  // --------------------------------------------------------------------------
  // create
  // --------------------------------------------------------------------------
  describe('create', () => {
    it('should create and return assistant within a transaction', async () => {
      const row = createMockRow()
      const txInsert = vi.fn().mockReturnValue(mockChain([row]))
      const txDelete = vi.fn().mockReturnValue(mockChain(undefined))
      const mockTx = { insert: txInsert, delete: txDelete }

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(mockTx))

      const result = await assistantDataService.create({ name: 'test-assistant' })
      expect(result.id).toBe('ast-1')
      expect(result.name).toBe('test-assistant')
      expect(mockDb.transaction).toHaveBeenCalledOnce()
    })

    it('should sync relation junction rows when provided', async () => {
      const row = createMockRow()
      const txInsert = vi.fn().mockReturnValue(mockChain([row]))
      const txDelete = vi.fn().mockReturnValue(mockChain(undefined))
      const mockTx = { insert: txInsert, delete: txDelete }

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(mockTx))

      await assistantDataService.create({
        name: 'test-assistant',
        modelIds: ['model-1'],
        mcpServerIds: ['srv-1'],
        knowledgeBaseIds: ['kb-1']
      })

      // 1 assistant insert + 3 junction inserts (models, mcpServers, knowledgeBases)
      expect(txInsert).toHaveBeenCalledTimes(4)
    })

    it('should throw validation error when name is empty', async () => {
      await expect(assistantDataService.create({ name: '' })).rejects.toThrow(DataApiError)
      await expect(assistantDataService.create({ name: '' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('should throw validation error when name is whitespace only', async () => {
      await expect(assistantDataService.create({ name: '   ' })).rejects.toThrow(DataApiError)
    })
  })

  // --------------------------------------------------------------------------
  // update
  // --------------------------------------------------------------------------
  describe('update', () => {
    it('should update and return assistant within a transaction', async () => {
      const existing = createMockRow()
      const updated = createMockRow({ name: 'updated-name' })
      mockDb.select.mockReturnValue(mockChain([existing]))

      const txUpdate = vi.fn().mockReturnValue(mockChain([updated]))
      const txDelete = vi.fn().mockReturnValue(mockChain(undefined))
      const txInsert = vi.fn().mockReturnValue(mockChain(undefined))
      const mockTx = { update: txUpdate, delete: txDelete, insert: txInsert }

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(mockTx))

      const result = await assistantDataService.update('ast-1', { name: 'updated-name' })
      expect(result.name).toBe('updated-name')
      expect(mockDb.transaction).toHaveBeenCalledOnce()
    })

    it('should NOT pass relation fields to the SQL UPDATE', async () => {
      const existing = createMockRow()
      mockDb.select.mockReturnValue(mockChain([existing]))

      let capturedSetArg: any
      const txUpdate = vi.fn().mockReturnValue(
        new Proxy(
          {
            then: (resolve: (v: unknown) => unknown) => Promise.resolve([existing]).then(resolve)
          },
          {
            get(target, prop) {
              if (prop === 'then') return target.then
              if (prop === 'set') {
                return (arg: any) => {
                  capturedSetArg = arg
                  return new Proxy(target, {
                    get(t, p) {
                      if (p === 'then') return t.then
                      return () =>
                        new Proxy(t, {
                          get(t2, p2) {
                            if (p2 === 'then') return t2.then
                            return () => t2
                          }
                        })
                    }
                  })
                }
              }
              return () =>
                new Proxy(target, {
                  get(t, p) {
                    if (p === 'then') return t.then
                    return () => t
                  }
                })
            }
          }
        )
      )
      const txDelete = vi.fn().mockReturnValue(mockChain(undefined))
      const txInsert = vi.fn().mockReturnValue(mockChain(undefined))
      const mockTx = { update: txUpdate, delete: txDelete, insert: txInsert }

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(mockTx))

      await assistantDataService.update('ast-1', {
        name: 'updated',
        modelIds: ['model-1'],
        mcpServerIds: ['srv-1'],
        knowledgeBaseIds: ['kb-1']
      })

      // The set() call should NOT contain relation fields
      expect(capturedSetArg).toBeDefined()
      expect(capturedSetArg).not.toHaveProperty('modelIds')
      expect(capturedSetArg).not.toHaveProperty('mcpServerIds')
      expect(capturedSetArg).not.toHaveProperty('knowledgeBaseIds')
      expect(capturedSetArg).toHaveProperty('name', 'updated')
    })

    it('should throw NOT_FOUND when updating non-existent assistant', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      await expect(assistantDataService.update('non-existent', { name: 'x' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw validation error when name is set to empty', async () => {
      const existing = createMockRow()
      mockDb.select.mockReturnValue(mockChain([existing]))

      await expect(assistantDataService.update('ast-1', { name: '' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })
  })

  // --------------------------------------------------------------------------
  // delete
  // --------------------------------------------------------------------------
  describe('delete', () => {
    it('should soft-delete an existing assistant', async () => {
      const existing = createMockRow()
      mockDb.select.mockReturnValue(mockChain([existing]))
      mockDb.update.mockReturnValue(mockChain(undefined))

      await expect(assistantDataService.delete('ast-1')).resolves.toBeUndefined()
    })

    it('should throw NOT_FOUND when deleting non-existent assistant', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      await expect(assistantDataService.delete('non-existent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })
})
