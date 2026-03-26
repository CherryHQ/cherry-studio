import { DataApiError, ErrorCode } from '@shared/data/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MCPServerService, mcpServerService } from '../McpServerService'

// ============================================================================
// DB Mock Helpers
// ============================================================================

function createMockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'srv-1',
    name: 'test-server',
    type: 'stdio',
    description: null,
    baseUrl: null,
    command: 'npx',
    registryUrl: null,
    args: ['-y', 'my-server'],
    env: { API_KEY: 'test' },
    headers: null,
    provider: null,
    providerUrl: null,
    logoUrl: null,
    tags: null,
    longRunning: null,
    timeout: null,
    dxtVersion: null,
    dxtPath: null,
    reference: null,
    searchKey: null,
    configSample: null,
    disabledTools: null,
    disabledAutoApproveTools: null,
    shouldConfig: null,
    isActive: false,
    installSource: 'manual',
    isTrusted: null,
    trustedAt: null,
    installedAt: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
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

describe('MCPServerService', () => {
  beforeEach(() => {
    mockDb = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    }
  })

  it('should export a module-level singleton', () => {
    expect(mcpServerService).toBeInstanceOf(MCPServerService)
  })

  // --------------------------------------------------------------------------
  // getById
  // --------------------------------------------------------------------------
  describe('getById', () => {
    it('should return a server when found', async () => {
      const row = createMockRow()
      mockDb.select.mockReturnValue(mockChain([row]))

      const result = await mcpServerService.getById('srv-1')
      expect(result.id).toBe('srv-1')
      expect(result.name).toBe('test-server')
      expect(result.isActive).toBe(false)
      expect(typeof result.createdAt).toBe('string')
    })

    it('should throw NOT_FOUND when server does not exist', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      await expect(mcpServerService.getById('non-existent')).rejects.toThrow(DataApiError)
      await expect(mcpServerService.getById('non-existent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  // --------------------------------------------------------------------------
  // list
  // --------------------------------------------------------------------------
  describe('list', () => {
    it('should return all servers when no filters', async () => {
      const rows = [createMockRow(), createMockRow({ id: 'srv-2', name: 'second' })]
      mockDb.select.mockReturnValueOnce(mockChain(rows)).mockReturnValueOnce(mockChain([{ count: 2 }]))

      const result = await mcpServerService.list({})
      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(2)
    })

    it('should filter by isActive', async () => {
      const rows = [createMockRow({ isActive: true })]
      mockDb.select.mockReturnValueOnce(mockChain(rows)).mockReturnValueOnce(mockChain([{ count: 1 }]))

      const result = await mcpServerService.list({ isActive: true })
      expect(result.items).toHaveLength(1)
      expect(result.items[0].isActive).toBe(true)
    })

    it('should filter by type', async () => {
      const rows = [createMockRow({ type: 'sse' })]
      mockDb.select.mockReturnValueOnce(mockChain(rows)).mockReturnValueOnce(mockChain([{ count: 1 }]))

      const result = await mcpServerService.list({ type: 'sse' })
      expect(result.items).toHaveLength(1)
    })
  })

  // --------------------------------------------------------------------------
  // create
  // --------------------------------------------------------------------------
  describe('create', () => {
    it('should create and return server', async () => {
      const row = createMockRow()
      mockDb.insert.mockReturnValue(mockChain([row]))

      const result = await mcpServerService.create({ name: 'test-server', command: 'npx' })
      expect(result.id).toBe('srv-1')
      expect(result.name).toBe('test-server')
    })

    it('should throw validation error when name is empty', async () => {
      await expect(mcpServerService.create({ name: '' })).rejects.toThrow(DataApiError)
      await expect(mcpServerService.create({ name: '' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('should throw validation error when name is whitespace only', async () => {
      await expect(mcpServerService.create({ name: '   ' })).rejects.toThrow(DataApiError)
    })
  })

  // --------------------------------------------------------------------------
  // update
  // --------------------------------------------------------------------------
  describe('update', () => {
    it('should update and return server', async () => {
      const existing = createMockRow()
      const updated = createMockRow({ name: 'updated-name' })
      mockDb.select.mockReturnValue(mockChain([existing]))
      mockDb.update.mockReturnValue(mockChain([updated]))

      const result = await mcpServerService.update('srv-1', { name: 'updated-name' })
      expect(result.name).toBe('updated-name')
    })

    it('should throw NOT_FOUND when updating non-existent server', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      await expect(mcpServerService.update('non-existent', { name: 'x' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw validation error when name is set to empty', async () => {
      const existing = createMockRow()
      mockDb.select.mockReturnValue(mockChain([existing]))

      await expect(mcpServerService.update('srv-1', { name: '' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })
  })

  // --------------------------------------------------------------------------
  // delete
  // --------------------------------------------------------------------------
  describe('delete', () => {
    it('should delete an existing server', async () => {
      const existing = createMockRow()
      mockDb.select.mockReturnValue(mockChain([existing]))
      mockDb.delete.mockReturnValue(mockChain(undefined))

      await expect(mcpServerService.delete('srv-1')).resolves.toBeUndefined()
    })

    it('should throw NOT_FOUND when deleting non-existent server', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      await expect(mcpServerService.delete('non-existent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  // --------------------------------------------------------------------------
  // findByIdOrName
  // --------------------------------------------------------------------------
  describe('findByIdOrName', () => {
    it('should return server when found by id', async () => {
      const row = createMockRow()
      mockDb.select.mockReturnValue(mockChain([row]))

      const result = await mcpServerService.findByIdOrName('srv-1')
      expect(result).toBeDefined()
      expect(result!.id).toBe('srv-1')
    })

    it('should fall back to name lookup when id not found', async () => {
      const row = createMockRow({ id: 'srv-1', name: 'my-server' })
      // First call (by id) returns empty, second call (by name) returns the row
      mockDb.select.mockReturnValueOnce(mockChain([])).mockReturnValueOnce(mockChain([row]))

      const result = await mcpServerService.findByIdOrName('my-server')
      expect(result).toBeDefined()
      expect(result!.name).toBe('my-server')
    })

    it('should return undefined when not found by id or name', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      const result = await mcpServerService.findByIdOrName('non-existent')
      expect(result).toBeUndefined()
    })
  })

  // --------------------------------------------------------------------------
  // reorder
  // --------------------------------------------------------------------------
  describe('reorder', () => {
    it('should update sortOrder for each server in a transaction', async () => {
      const txUpdate = vi.fn().mockReturnValue(mockChain(undefined))
      const mockTx = { update: txUpdate }

      mockDb.transaction = vi.fn().mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn(mockTx)
      })

      await mcpServerService.reorder(['srv-a', 'srv-b', 'srv-c'])

      expect(mockDb.transaction).toHaveBeenCalledOnce()
      expect(txUpdate).toHaveBeenCalledTimes(3)
    })

    it('should handle empty array', async () => {
      mockDb.transaction = vi.fn().mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn({ update: vi.fn() })
      })

      await mcpServerService.reorder([])

      expect(mockDb.transaction).toHaveBeenCalledOnce()
    })
  })
})
