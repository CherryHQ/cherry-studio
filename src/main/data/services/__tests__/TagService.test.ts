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

/**
 * Creates a transaction mock that tracks data passed to .values() and .where().
 *
 * Usage:
 *   const tx = createTrackingTx([...existingRows])
 *   // after test:
 *   tx.insertedValues  — array of values() arguments
 *   tx.deleteCalls     — number of delete().where() invocations
 */
function createTrackingTx(existingRows: Record<string, unknown>[] = []) {
  const insertedValues: unknown[] = []
  let deleteCalls = 0

  const select = vi.fn(() => ({
    from: () => ({
      where: () => mockChain(existingRows)
    })
  }))

  const insert = vi.fn(() => ({
    values: (vals: unknown) => {
      insertedValues.push(vals)
      return mockChain(undefined)
    }
  }))

  const del = vi.fn(() => ({
    where: () => {
      deleteCalls++
      return mockChain(undefined)
    }
  }))

  return {
    select,
    insert,
    delete: del,
    get insertedValues() {
      return insertedValues
    },
    get deleteCalls() {
      return deleteCalls
    }
  }
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
  // rowToTag (tested indirectly via getById)
  // --------------------------------------------------------------------------
  describe('rowToTag mapping', () => {
    it('should convert numeric timestamps to ISO strings', async () => {
      mockDb.select.mockReturnValue(
        mockChain([createMockTagRow({ createdAt: 1700000000000, updatedAt: 1700000000000 })])
      )

      const result = await tagDataService.getById('tag-1')
      expect(result.createdAt).toBe(new Date(1700000000000).toISOString())
      expect(result.updatedAt).toBe(new Date(1700000000000).toISOString())
    })

    it('should normalize null color to null', async () => {
      mockDb.select.mockReturnValue(mockChain([createMockTagRow({ color: null })]))

      const result = await tagDataService.getById('tag-1')
      expect(result.color).toBeNull()
    })

    it('should normalize undefined color to null', async () => {
      mockDb.select.mockReturnValue(mockChain([createMockTagRow({ color: undefined })]))

      const result = await tagDataService.getById('tag-1')
      expect(result.color).toBeNull()
    })

    it('should fallback to current time when timestamps are null', async () => {
      const before = new Date().toISOString()
      mockDb.select.mockReturnValue(mockChain([createMockTagRow({ createdAt: null, updatedAt: null })]))

      const result = await tagDataService.getById('tag-1')
      expect(result.createdAt >= before).toBe(true)
      expect(result.updatedAt >= before).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // getById
  // --------------------------------------------------------------------------
  describe('getById', () => {
    it('should return a fully mapped tag when found', async () => {
      mockDb.select.mockReturnValue(mockChain([createMockTagRow()]))

      const result = await tagDataService.getById('tag-1')
      expect(result).toMatchObject({
        id: 'tag-1',
        name: 'work',
        color: '#ff0000'
      })
      expect(typeof result.createdAt).toBe('string')
      expect(typeof result.updatedAt).toBe('string')
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
    it('should return all tags mapped through rowToTag', async () => {
      const rows = [createMockTagRow(), createMockTagRow({ id: 'tag-2', name: 'personal', color: null })]
      mockDb.select.mockReturnValue(mockChain(rows))

      const result = await tagDataService.list()
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ id: 'tag-1', name: 'work', color: '#ff0000' })
      expect(result[1]).toMatchObject({ id: 'tag-2', name: 'personal', color: null })
    })

    it('should return empty array when no tags exist', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      const result = await tagDataService.list()
      expect(result).toEqual([])
    })
  })

  // --------------------------------------------------------------------------
  // create
  // --------------------------------------------------------------------------
  describe('create', () => {
    it('should call db.insert and return mapped tag', async () => {
      const row = createMockTagRow()
      mockDb.insert.mockReturnValue(mockChain([row]))

      const result = await tagDataService.create({ name: 'work', color: '#ff0000' })
      expect(mockDb.insert).toHaveBeenCalledOnce()
      expect(result).toMatchObject({ id: 'tag-1', name: 'work', color: '#ff0000' })
    })

    it('should throw CONFLICT when name already exists', async () => {
      mockDb.insert.mockReturnValue(mockChainReject(new Error('UNIQUE constraint failed: tag.name')))

      await expect(tagDataService.create({ name: 'work' })).rejects.toThrow(DataApiError)
      await expect(tagDataService.create({ name: 'work' })).rejects.toMatchObject({
        code: ErrorCode.CONFLICT
      })
    })

    it('should re-throw non-unique DB errors as-is', async () => {
      mockDb.insert.mockReturnValue(mockChainReject(new Error('connection lost')))

      await expect(tagDataService.create({ name: 'work' })).rejects.toThrow('connection lost')
    })
  })

  // --------------------------------------------------------------------------
  // update
  // --------------------------------------------------------------------------
  describe('update', () => {
    it('should call db.update and return mapped tag', async () => {
      const updated = createMockTagRow({ name: 'updated', color: '#00ff00' })
      mockDb.update.mockReturnValue(mockChain([updated]))

      const result = await tagDataService.update('tag-1', { name: 'updated', color: '#00ff00' })
      expect(mockDb.update).toHaveBeenCalledOnce()
      expect(result).toMatchObject({ name: 'updated', color: '#00ff00' })
    })

    it('should throw NOT_FOUND when no row returned', async () => {
      mockDb.update.mockReturnValue(mockChain([]))

      await expect(tagDataService.update('non-existent', { name: 'x' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('should throw CONFLICT on duplicate name', async () => {
      mockDb.update.mockReturnValue(mockChainReject(new Error('UNIQUE constraint failed: tag.name')))

      await expect(tagDataService.update('tag-1', { name: 'duplicate' })).rejects.toMatchObject({
        code: ErrorCode.CONFLICT
      })
    })

    it('should re-throw non-unique DB errors as-is', async () => {
      mockDb.update.mockReturnValue(mockChainReject(new Error('disk full')))

      await expect(tagDataService.update('tag-1', { name: 'x' })).rejects.toThrow('disk full')
    })

    it('should fall back to getById when dto is empty (no db.update call)', async () => {
      mockDb.select.mockReturnValue(mockChain([createMockTagRow()]))

      const result = await tagDataService.update('tag-1', {})
      expect(mockDb.update).not.toHaveBeenCalled()
      expect(result.id).toBe('tag-1')
    })

    it('should update when only color is provided', async () => {
      const updated = createMockTagRow({ color: '#0000ff' })
      mockDb.update.mockReturnValue(mockChain([updated]))

      const result = await tagDataService.update('tag-1', { color: '#0000ff' })
      expect(mockDb.update).toHaveBeenCalledOnce()
      expect(result.color).toBe('#0000ff')
    })
  })

  // --------------------------------------------------------------------------
  // delete
  // --------------------------------------------------------------------------
  describe('delete', () => {
    it('should call db.delete and return void', async () => {
      mockDb.delete.mockReturnValue(mockChain([{ id: 'tag-1' }]))

      await expect(tagDataService.delete('tag-1')).resolves.toBeUndefined()
      expect(mockDb.delete).toHaveBeenCalledOnce()
    })

    it('should throw NOT_FOUND when no row deleted', async () => {
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
    it('should return mapped tags for an entity', async () => {
      const rows = [createMockTagRow(), createMockTagRow({ id: 'tag-2', name: 'coding' })]
      mockDb.select.mockReturnValue(mockChain(rows))

      const result = await tagDataService.getTagsByEntity('assistant', 'ast-1')
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ id: 'tag-1', name: 'work' })
      expect(result[1]).toMatchObject({ id: 'tag-2', name: 'coding' })
    })

    it('should return empty array when no tags for entity', async () => {
      mockDb.select.mockReturnValue(mockChain([]))

      const result = await tagDataService.getTagsByEntity('assistant', 'ast-1')
      expect(result).toEqual([])
    })
  })

  // --------------------------------------------------------------------------
  // syncEntityTags
  // --------------------------------------------------------------------------
  describe('syncEntityTags', () => {
    it('should remove old tags and add new ones (diff sync)', async () => {
      // existing: [tag-old, tag-keep], desired: [tag-keep, tag-new]
      const tx = createTrackingTx([{ tagId: 'tag-old' }, { tagId: 'tag-keep' }])

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn(tx)
      })

      await tagDataService.syncEntityTags('assistant', 'ast-1', {
        tagIds: ['tag-keep', 'tag-new']
      })

      // only tag-old should be removed
      expect(tx.deleteCalls).toBe(1)
      // only tag-new should be inserted, with correct entity context
      expect(tx.insertedValues).toEqual([[{ entityType: 'assistant', entityId: 'ast-1', tagId: 'tag-new' }]])
    })

    it('should only insert when no existing tags (add-only)', async () => {
      const tx = createTrackingTx([])

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn(tx)
      })

      await tagDataService.syncEntityTags('topic', 'topic-1', {
        tagIds: ['tag-a', 'tag-b']
      })

      expect(tx.deleteCalls).toBe(0)
      expect(tx.insertedValues).toEqual([
        [
          { entityType: 'topic', entityId: 'topic-1', tagId: 'tag-a' },
          { entityType: 'topic', entityId: 'topic-1', tagId: 'tag-b' }
        ]
      ])
    })

    it('should only delete when desired is empty (remove-all)', async () => {
      const tx = createTrackingTx([{ tagId: 'tag-1' }, { tagId: 'tag-2' }])

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn(tx)
      })

      await tagDataService.syncEntityTags('assistant', 'ast-1', {
        tagIds: []
      })

      expect(tx.deleteCalls).toBe(1)
      expect(tx.insertedValues).toEqual([])
    })

    it('should skip both delete and insert when tags already match', async () => {
      const tx = createTrackingTx([{ tagId: 'tag-1' }])

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn(tx)
      })

      await tagDataService.syncEntityTags('assistant', 'ast-1', {
        tagIds: ['tag-1']
      })

      expect(tx.deleteCalls).toBe(0)
      expect(tx.insertedValues).toEqual([])
    })
  })

  // --------------------------------------------------------------------------
  // setEntities
  // --------------------------------------------------------------------------
  describe('setEntities', () => {
    it('should diff-sync: remove old, keep unchanged, add new', async () => {
      // getById mock
      mockDb.select.mockReturnValue(mockChain([createMockTagRow()]))

      // existing: [assistant:ast-old, topic:topic-keep]
      // desired:  [topic:topic-keep, assistant:ast-new]
      const tx = createTrackingTx([
        { entityType: 'assistant', entityId: 'ast-old' },
        { entityType: 'topic', entityId: 'topic-keep' }
      ])

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn(tx)
      })

      await tagDataService.setEntities('tag-1', {
        entities: [
          { entityType: 'topic', entityId: 'topic-keep' },
          { entityType: 'assistant', entityId: 'ast-new' }
        ]
      })

      // ast-old removed (1 delete call)
      expect(tx.deleteCalls).toBe(1)
      // ast-new inserted with correct tag context
      expect(tx.insertedValues).toEqual([[{ entityType: 'assistant', entityId: 'ast-new', tagId: 'tag-1' }]])
    })

    it('should skip both when entities already match', async () => {
      mockDb.select.mockReturnValue(mockChain([createMockTagRow()]))

      const tx = createTrackingTx([{ entityType: 'assistant', entityId: 'ast-1' }])

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn(tx)
      })

      await tagDataService.setEntities('tag-1', {
        entities: [{ entityType: 'assistant', entityId: 'ast-1' }]
      })

      expect(tx.deleteCalls).toBe(0)
      expect(tx.insertedValues).toEqual([])
    })

    it('should remove all when entities list is empty', async () => {
      mockDb.select.mockReturnValue(mockChain([createMockTagRow()]))

      const tx = createTrackingTx([
        { entityType: 'assistant', entityId: 'ast-1' },
        { entityType: 'topic', entityId: 'topic-1' }
      ])

      mockDb.transaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn(tx)
      })

      await tagDataService.setEntities('tag-1', { entities: [] })

      // one delete per removed entity (loop-based)
      expect(tx.deleteCalls).toBe(2)
      expect(tx.insertedValues).toEqual([])
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

    it('should include entities with zero tags as empty arrays', async () => {
      mockDb.select.mockReturnValue(mockChain([{ entityId: 'ast-1', tagId: 'tag-1' }]))

      const result = await tagDataService.getTagIdsByEntities('assistant', ['ast-1', 'ast-2'])
      expect(result.get('ast-1')).toEqual(['tag-1'])
      expect(result.get('ast-2')).toEqual([])
    })

    it('should return empty map for empty input without querying DB', async () => {
      const result = await tagDataService.getTagIdsByEntities('assistant', [])
      expect(result.size).toBe(0)
      expect(mockDb.select).not.toHaveBeenCalled()
    })
  })
})
