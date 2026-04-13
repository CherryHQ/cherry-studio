import { DataApiError, ErrorCode } from '@shared/data/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TagDataService, tagDataService } from '../TagService'

// ============================================================================
// DB Mock Helpers
// ============================================================================

function createMockTagRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tag-1',
    name: 'work',
    color: '#ff0000',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides
  }
}

/**
 * Creates a chainable mock that resolves to the given value when awaited.
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

/**
 * Creates a chainable mock that rejects with the given error when awaited.
 */
function mockChainReject(error: Error) {
  const thenable = {
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      return Promise.reject(error).then(resolve, reject)
    }
  }

  const chain: any = new Proxy(thenable, {
    get(target, prop) {
      if (prop === 'then') return target.then
      if (prop === 'catch' || prop === 'finally') {
        return (...args: unknown[]) => Promise.reject(error)[prop as 'catch'](...(args as [any]))
      }
      return () => chain
    }
  })

  return chain
}

let mockDb: any

vi.mock('@application', async () => {
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

describe('TagDataService', () => {
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
    expect(tagDataService).toBeInstanceOf(TagDataService)
  })

  // --------------------------------------------------------------------------
  // getById
  // --------------------------------------------------------------------------
  describe('getById', () => {
    it('should return a tag when found', async () => {
      const row = createMockTagRow()
      mockDb.select.mockReturnValue(mockChain([row]))

      const result = await tagDataService.getById('tag-1')
      expect(result.id).toBe('tag-1')
      expect(result.name).toBe('work')
      expect(result.color).toBe('#ff0000')
      expect(typeof result.createdAt).toBe('string')
    })

    it('should throw NOT_FOUND when tag does not exist', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      await expect(tagDataService.getById('non-existent')).rejects.toThrow(DataApiError)
      await expect(tagDataService.getById('non-existent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  // --------------------------------------------------------------------------
  // list
  // --------------------------------------------------------------------------
  describe('list', () => {
    it('should return all tags', async () => {
      const rows = [createMockTagRow(), createMockTagRow({ id: 'tag-2', name: 'personal' })]
      mockDb.select.mockReturnValue(mockChain(rows))

      const result = await tagDataService.list()
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('work')
      expect(result[1].name).toBe('personal')
    })

    it('should return empty array when no tags exist', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      const result = await tagDataService.list()
      expect(result).toHaveLength(0)
    })
  })

  // --------------------------------------------------------------------------
  // create
  // --------------------------------------------------------------------------
  describe('create', () => {
    it('should create and return tag', async () => {
      const row = createMockTagRow()
      mockDb.insert.mockReturnValue(mockChain([row]))

      const result = await tagDataService.create({ name: 'work', color: '#ff0000' })
      expect(result.id).toBe('tag-1')
      expect(result.name).toBe('work')
    })

    it('should throw CONFLICT when name already exists', async () => {
      mockDb.insert.mockReturnValue(mockChainReject(new Error('UNIQUE constraint failed: tag.name')))

      await expect(tagDataService.create({ name: 'work' })).rejects.toThrow(DataApiError)
      await expect(tagDataService.create({ name: 'work' })).rejects.toMatchObject({
        code: ErrorCode.CONFLICT
      })
    })

    it('should re-throw non-unique errors', async () => {
      const dbError = new Error('connection lost')
      mockDb.insert.mockReturnValue(mockChainReject(dbError))

      await expect(tagDataService.create({ name: 'work' })).rejects.toThrow('connection lost')
    })
  })

  // --------------------------------------------------------------------------
  // update
  // --------------------------------------------------------------------------
  describe('update', () => {
    it('should update and return tag', async () => {
      const updated = createMockTagRow({ name: 'updated-tag', color: '#00ff00' })
      mockDb.update.mockReturnValue(mockChain([updated]))

      const result = await tagDataService.update('tag-1', { name: 'updated-tag', color: '#00ff00' })
      expect(result.name).toBe('updated-tag')
      expect(result.color).toBe('#00ff00')
    })

    it('should throw NOT_FOUND when updating non-existent tag', async () => {
      mockDb.update.mockReturnValue(mockChain([]))

      await expect(tagDataService.update('non-existent', { name: 'x' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw CONFLICT when name already exists', async () => {
      mockDb.update.mockReturnValue(mockChainReject(new Error('UNIQUE constraint failed: tag.name')))

      await expect(tagDataService.update('tag-1', { name: 'duplicate' })).rejects.toMatchObject({
        code: ErrorCode.CONFLICT
      })
    })

    it('should fall back to getById when no fields to update', async () => {
      const row = createMockTagRow()
      mockDb.select.mockReturnValue(mockChain([row]))

      const result = await tagDataService.update('tag-1', {})
      expect(result.id).toBe('tag-1')
      expect(mockDb.update).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // delete
  // --------------------------------------------------------------------------
  describe('delete', () => {
    it('should delete an existing tag', async () => {
      mockDb.delete.mockReturnValue(mockChain([{ id: 'tag-1' }]))

      await expect(tagDataService.delete('tag-1')).resolves.toBeUndefined()
    })

    it('should throw NOT_FOUND when deleting non-existent tag', async () => {
      mockDb.delete.mockReturnValue(mockChain([]))

      await expect(tagDataService.delete('non-existent')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  // --------------------------------------------------------------------------
  // getTagsByEntity
  // --------------------------------------------------------------------------
  describe('getTagsByEntity', () => {
    it('should return tags for an entity', async () => {
      const rows = [createMockTagRow(), createMockTagRow({ id: 'tag-2', name: 'coding' })]
      mockDb.select.mockReturnValue(mockChain(rows))

      const result = await tagDataService.getTagsByEntity('assistant', 'ast-1')
      expect(result).toHaveLength(2)
    })

    it('should return empty array when no tags for entity', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      const result = await tagDataService.getTagsByEntity('assistant', 'ast-1')
      expect(result).toHaveLength(0)
    })
  })

  // --------------------------------------------------------------------------
  // syncEntityTags
  // --------------------------------------------------------------------------
  describe('syncEntityTags', () => {
    it('should sync entity tags within a transaction', async () => {
      const txSelect = vi.fn().mockReturnValue(mockChain([{ tagId: 'tag-old' }]))
      const txDelete = vi.fn().mockReturnValue(mockChain(undefined))
      const txInsert = vi.fn().mockReturnValue(mockChain(undefined))
      const mockTx = { select: txSelect, delete: txDelete, insert: txInsert }

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn(mockTx)
      })

      await tagDataService.syncEntityTags('assistant', 'ast-1', {
        tagIds: ['tag-new']
      })

      expect(mockDb.transaction).toHaveBeenCalledOnce()
    })
  })

  // --------------------------------------------------------------------------
  // setEntities
  // --------------------------------------------------------------------------
  describe('setEntities', () => {
    it('should diff-sync entity associations for a tag', async () => {
      // getById mock
      const existing = createMockTagRow()
      mockDb.select.mockReturnValue(mockChain([existing]))

      const txSelect = vi.fn().mockReturnValue(
        mockChain([
          { entityType: 'assistant', entityId: 'ast-old' },
          { entityType: 'topic', entityId: 'topic-keep' }
        ])
      )
      const txDelete = vi.fn().mockReturnValue(mockChain(undefined))
      const txInsert = vi.fn().mockReturnValue(mockChain(undefined))
      const mockTx = { select: txSelect, delete: txDelete, insert: txInsert }

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn(mockTx)
      })

      await tagDataService.setEntities('tag-1', {
        entities: [
          { entityType: 'topic', entityId: 'topic-keep' },
          { entityType: 'assistant', entityId: 'ast-new' }
        ]
      })

      expect(mockDb.transaction).toHaveBeenCalledOnce()
    })

    it('should throw NOT_FOUND when tag does not exist', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      await expect(tagDataService.setEntities('non-existent', { entities: [] })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  // --------------------------------------------------------------------------
  // getTagIdsByEntities
  // --------------------------------------------------------------------------
  describe('getTagIdsByEntities', () => {
    it('should return map of entity IDs to tag IDs', async () => {
      const rows = [
        { entityId: 'ast-1', tagId: 'tag-1' },
        { entityId: 'ast-1', tagId: 'tag-2' },
        { entityId: 'ast-2', tagId: 'tag-1' }
      ]
      mockDb.select.mockReturnValue(mockChain(rows))

      const result = await tagDataService.getTagIdsByEntities('assistant', ['ast-1', 'ast-2'])
      expect(result.get('ast-1')).toEqual(['tag-1', 'tag-2'])
      expect(result.get('ast-2')).toEqual(['tag-1'])
    })

    it('should return empty map for empty input', async () => {
      const result = await tagDataService.getTagIdsByEntities('assistant', [])
      expect(result.size).toBe(0)
    })
  })
})
