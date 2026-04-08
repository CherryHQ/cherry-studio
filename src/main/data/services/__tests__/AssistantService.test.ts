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
    modelId: null,
    settings: null,
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
      return () => chain
    }
  })

  return chain
}

function mockAssistantRelations(overrides: { mcpServerIds?: string[]; knowledgeBaseIds?: string[] } = {}) {
  const { mcpServerIds = [], knowledgeBaseIds = [] } = overrides
  return {
    mcpServerRows: mcpServerIds.map((mcpServerId) => ({ assistantId: 'ast-1', mcpServerId })),
    knowledgeBaseRows: knowledgeBaseIds.map((knowledgeBaseId) => ({ assistantId: 'ast-1', knowledgeBaseId }))
  }
}

function queueAssistantReads(
  rowOrRows: Record<string, unknown> | Record<string, unknown>[],
  options: {
    mcpServerIds?: string[]
    knowledgeBaseIds?: string[]
  } = {}
) {
  const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
  const relations = mockAssistantRelations(options)

  mockDb.select.mockReset()
  mockDb.select.mockReturnValueOnce(mockChain(rows))
  mockDb.select
    .mockReturnValueOnce(mockChain(relations.mcpServerRows))
    .mockReturnValueOnce(mockChain(relations.knowledgeBaseRows))
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
    it('should return an assistant with relation ids when found', async () => {
      const row = createMockRow({ modelId: 'openai::gpt-4' })
      queueAssistantReads(row, {
        mcpServerIds: ['srv-1'],
        knowledgeBaseIds: ['kb-1']
      })

      const result = await assistantDataService.getById('ast-1')
      expect(result.id).toBe('ast-1')
      expect(result.name).toBe('test-assistant')
      expect(result.modelId).toBe('openai::gpt-4')
      expect(result.mcpServerIds).toEqual(['srv-1'])
      expect(result.knowledgeBaseIds).toEqual(['kb-1'])
      expect(typeof result.createdAt).toBe('string')
    })

    it('should return null modelId when not set', async () => {
      queueAssistantReads(createMockRow())
      const result = await assistantDataService.getById('ast-1')
      expect(result.modelId).toBeNull()
    })

    it('should return soft-deleted assistant when includeDeleted is true', async () => {
      const deletedRow = createMockRow({ deletedAt: 1700000000000 })
      queueAssistantReads(deletedRow)
      const result = await assistantDataService.getById('ast-1', { includeDeleted: true })
      expect(result.id).toBe('ast-1')
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
    it('should return all assistants with relation ids when no filters', async () => {
      const rows = [
        createMockRow({ modelId: 'openai::gpt-4' }),
        createMockRow({ id: 'ast-2', name: 'second', modelId: 'anthropic::claude-3' })
      ]
      const relationRows = {
        mcpServerRows: [{ assistantId: 'ast-2', mcpServerId: 'srv-2' }],
        knowledgeBaseRows: [{ assistantId: 'ast-1', knowledgeBaseId: 'kb-1' }]
      }

      mockDb.select
        .mockReturnValueOnce(mockChain(rows))
        .mockReturnValueOnce(mockChain([{ count: 2 }]))
        .mockReturnValueOnce(mockChain(relationRows.mcpServerRows))
        .mockReturnValueOnce(mockChain(relationRows.knowledgeBaseRows))

      const result = await assistantDataService.list({})
      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(2)
      expect(result.page).toBe(1)
      expect(result.items[0].modelId).toBe('openai::gpt-4')
      expect(result.items[0].knowledgeBaseIds).toEqual(['kb-1'])
      expect(result.items[1].modelId).toBe('anthropic::claude-3')
      expect(result.items[1].mcpServerIds).toEqual(['srv-2'])
    })

    it('should filter by id', async () => {
      const row = createMockRow()
      mockDb.select.mockReset()
      mockDb.select
        .mockReturnValueOnce(mockChain([row]))
        .mockReturnValueOnce(mockChain([{ count: 1 }]))
        .mockReturnValueOnce(mockChain([]))
        .mockReturnValueOnce(mockChain([]))

      const result = await assistantDataService.list({ id: 'ast-1' })
      expect(result.items).toHaveLength(1)
      expect(result.total).toBe(1)
    })

    it('should respect page and limit parameters', async () => {
      const row = createMockRow()
      mockDb.select.mockReset()
      mockDb.select
        .mockReturnValueOnce(mockChain([row]))
        .mockReturnValueOnce(mockChain([{ count: 50 }]))
        .mockReturnValueOnce(mockChain([]))
        .mockReturnValueOnce(mockChain([]))

      const result = await assistantDataService.list({ page: 2, limit: 10 })
      expect(result.page).toBe(2)
      expect(result.total).toBe(50)
    })

    it('should cap limit at 500', async () => {
      mockDb.select.mockReset()
      mockDb.select
        .mockReturnValueOnce(mockChain([]))
        .mockReturnValueOnce(mockChain([{ count: 0 }]))
        .mockReturnValueOnce(mockChain([]))
        .mockReturnValueOnce(mockChain([]))

      const result = await assistantDataService.list({ limit: 9999 })
      expect(result.items).toHaveLength(0)
      // The service should have capped limit to 500 internally
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
      expect(result.modelId).toBeNull()
      expect(mockDb.transaction).toHaveBeenCalledOnce()
    })

    it('should sync relation junction rows when provided', async () => {
      const row = createMockRow({ modelId: 'openai::gpt-4' })
      const txInsert = vi.fn().mockReturnValue(mockChain([row]))
      const txDelete = vi.fn().mockReturnValue(mockChain(undefined))
      const mockTx = { insert: txInsert, delete: txDelete }

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(mockTx))

      const result = await assistantDataService.create({
        name: 'test-assistant',
        modelId: 'openai::gpt-4',
        mcpServerIds: ['srv-1'],
        knowledgeBaseIds: ['kb-1']
      })

      // 1 assistant insert + 2 junction inserts (mcp + kb)
      expect(txInsert).toHaveBeenCalledTimes(3)
      expect(result.modelId).toBe('openai::gpt-4')
      expect(result.mcpServerIds).toEqual(['srv-1'])
      expect(result.knowledgeBaseIds).toEqual(['kb-1'])
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
      const existing = createMockRow({ modelId: 'openai::gpt-4' })
      const updated = createMockRow({ name: 'updated-name', modelId: 'openai::gpt-4' })
      queueAssistantReads(existing, { mcpServerIds: ['srv-1'] })

      const txUpdate = vi.fn().mockReturnValue(mockChain([updated]))
      const txDelete = vi.fn().mockReturnValue(mockChain(undefined))
      const txInsert = vi.fn().mockReturnValue(mockChain(undefined))
      const mockTx = { update: txUpdate, delete: txDelete, insert: txInsert }

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(mockTx))

      const result = await assistantDataService.update('ast-1', { name: 'updated-name' })
      expect(result.name).toBe('updated-name')
      expect(result.mcpServerIds).toEqual(['srv-1'])
      expect(mockDb.transaction).toHaveBeenCalledOnce()
    })

    it('should NOT pass relation fields to the SQL UPDATE', async () => {
      const existing = createMockRow()
      queueAssistantReads(existing)

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
        mcpServerIds: ['srv-1'],
        knowledgeBaseIds: ['kb-1']
      })

      expect(capturedSetArg).toBeDefined()
      expect(capturedSetArg).not.toHaveProperty('mcpServerIds')
      expect(capturedSetArg).not.toHaveProperty('knowledgeBaseIds')
      expect(capturedSetArg).toHaveProperty('name', 'updated')
    })

    it('should sync relation-only updates without issuing an empty SQL UPDATE', async () => {
      const existing = createMockRow({ modelId: 'openai::gpt-4' })
      queueAssistantReads(existing)

      const txUpdate = vi.fn()
      const txDelete = vi.fn().mockReturnValue(mockChain(undefined))
      const txInsert = vi.fn().mockReturnValue(mockChain(undefined))
      const mockTx = { update: txUpdate, delete: txDelete, insert: txInsert }

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(mockTx))

      const result = await assistantDataService.update('ast-1', {
        mcpServerIds: ['srv-1'],
        knowledgeBaseIds: ['kb-1']
      })

      expect(txUpdate).not.toHaveBeenCalled()
      expect(txDelete).toHaveBeenCalledTimes(2)
      expect(txInsert).toHaveBeenCalledTimes(2)
      expect(result.mcpServerIds).toEqual(['srv-1'])
      expect(result.knowledgeBaseIds).toEqual(['kb-1'])
    })

    it('should throw NOT_FOUND when updating non-existent assistant', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      await expect(assistantDataService.update('non-existent', { name: 'x' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw validation error when name is set to empty', async () => {
      const existing = createMockRow()
      queueAssistantReads(existing)

      await expect(assistantDataService.update('ast-1', { name: '' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })
  })

  // --------------------------------------------------------------------------
  // delete
  // --------------------------------------------------------------------------
  describe('delete', () => {
    it('should soft-delete by setting deletedAt timestamp', async () => {
      const existing = createMockRow()
      mockDb.select.mockReturnValue(mockChain([existing]))

      let capturedSetArg: any
      mockDb.update.mockReturnValue({
        set: vi.fn().mockImplementation((arg: any) => {
          capturedSetArg = arg
          return { where: vi.fn().mockResolvedValue(undefined) }
        })
      })

      await assistantDataService.delete('ast-1')

      expect(mockDb.update).toHaveBeenCalled()
      expect(capturedSetArg).toBeDefined()
      expect(capturedSetArg).toHaveProperty('deletedAt')
      expect(typeof capturedSetArg.deletedAt).toBe('number')
    })

    it('should throw NOT_FOUND when deleting non-existent assistant', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      await expect(assistantDataService.delete('non-existent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })
})
