import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NoteMigrator } from '../NoteMigrator'

// --- helpers ---

function mockReduxState(data: Record<string, Record<string, unknown>>) {
  return {
    get: vi.fn(<T>(category: string, key?: string): T | undefined => {
      const cat = data[category] as Record<string, unknown> | undefined
      if (!cat) return undefined
      if (!key) return cat as T
      return key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], cat) as T
    }),
    getCategory: vi.fn((cat: string) => data[cat]),
    hasCategory: vi.fn((cat: string) => cat in data)
  }
}

function createMockContext(reduxData: Record<string, Record<string, unknown>> = {}) {
  const insertValues = vi.fn().mockResolvedValue(undefined)
  const insert = vi.fn().mockReturnValue({ values: insertValues })
  const selectFromGet = vi.fn().mockResolvedValue({ count: 0 })
  const selectFrom = vi.fn().mockReturnValue({ get: selectFromGet })
  const select = vi.fn().mockReturnValue({ from: selectFrom })
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
    await fn({ insert })
  })

  return {
    ctx: {
      sources: {
        reduxState: mockReduxState(reduxData),
        dexieExport: { readTable: vi.fn(), createStreamReader: vi.fn(), tableExists: vi.fn() },
        dexieSettings: { get: vi.fn(), keys: vi.fn() },
        electronStore: { get: vi.fn() }
      },
      db: { transaction, select, insert },
      sharedData: new Map(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    },
    mocks: { insert, insertValues, select, selectFrom, selectFromGet, transaction }
  }
}

// --- toRelativePath tests ---

describe('NoteMigrator', () => {
  let migrator: NoteMigrator

  beforeEach(() => {
    migrator = new NoteMigrator()
    migrator.setProgressCallback(vi.fn())
  })

  describe('metadata', () => {
    it('should have correct id and order', () => {
      expect(migrator.id).toBe('note')
      expect(migrator.order).toBe(5)
    })
  })

  describe('prepare', () => {
    it('should return 0 items when no starred paths exist', async () => {
      const { ctx } = createMockContext({})
      const result = await migrator.prepare(ctx as never)
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('should return 0 items when starredPaths is empty array', async () => {
      const { ctx } = createMockContext({ note: { starredPaths: [], notesPath: '/notes' } })
      const result = await migrator.prepare(ctx as never)
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('should count starred paths', async () => {
      const { ctx } = createMockContext({
        note: { starredPaths: ['/notes/a.md', '/notes/b.md'], notesPath: '/notes' }
      })
      const result = await migrator.prepare(ctx as never)
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(2)
    })

    it('should deduplicate starred paths', async () => {
      const { ctx } = createMockContext({
        note: { starredPaths: ['/notes/a.md', '/notes/a.md', '/notes/b.md'], notesPath: '/notes' }
      })
      const result = await migrator.prepare(ctx as never)
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(2)
    })

    it('should filter out empty/invalid paths', async () => {
      const { ctx } = createMockContext({
        note: { starredPaths: ['/notes/a.md', '', '  ', null, undefined, '/notes/b.md'], notesPath: '/notes' }
      })
      const result = await migrator.prepare(ctx as never)
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(2)
    })
  })

  describe('execute', () => {
    it('should return 0 when no items to migrate', async () => {
      const { ctx } = createMockContext({})
      await migrator.prepare(ctx as never)
      const result = await migrator.execute(ctx as never)
      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(0)
    })

    it('should insert starred paths with isStarred=true', async () => {
      const { ctx, mocks } = createMockContext({
        note: { starredPaths: ['/notes/a.md', '/notes/sub/b.md'], notesPath: '/notes' }
      })
      await migrator.prepare(ctx as never)
      const result = await migrator.execute(ctx as never)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(2)
      expect(mocks.insertValues).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ relativePath: 'a.md', isStarred: true }),
          expect.objectContaining({ relativePath: 'sub/b.md', isStarred: true })
        ])
      )
    })

    it('should use raw path when notesRoot is empty', async () => {
      const { ctx, mocks } = createMockContext({
        note: { starredPaths: ['/some/path.md'], notesPath: '' }
      })
      await migrator.prepare(ctx as never)
      await migrator.execute(ctx as never)

      expect(mocks.insertValues).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ relativePath: '/some/path.md' })])
      )
    })
  })

  describe('validate', () => {
    it('should pass when counts match', async () => {
      const { ctx, mocks } = createMockContext({
        note: { starredPaths: ['/notes/a.md', '/notes/b.md'], notesPath: '/notes' }
      })
      mocks.selectFromGet.mockResolvedValue({ count: 2 })

      await migrator.prepare(ctx as never)
      const result = await migrator.validate(ctx as never)

      expect(result.success).toBe(true)
      expect(result.stats.sourceCount).toBe(2)
      expect(result.stats.targetCount).toBe(2)
    })

    it('should pass with 0 items', async () => {
      const { ctx, mocks } = createMockContext({})
      mocks.selectFromGet.mockResolvedValue({ count: 0 })

      await migrator.prepare(ctx as never)
      const result = await migrator.validate(ctx as never)

      expect(result.success).toBe(true)
      expect(result.stats.sourceCount).toBe(0)
      expect(result.stats.targetCount).toBe(0)
    })

    it('should handle db error gracefully', async () => {
      const { ctx, mocks } = createMockContext({
        note: { starredPaths: ['/notes/a.md'], notesPath: '/notes' }
      })
      mocks.selectFromGet.mockRejectedValue(new Error('DB error'))

      await migrator.prepare(ctx as never)
      const result = await migrator.validate(ctx as never)

      expect(result.success).toBe(false)
      expect(result.errors).toHaveLength(1)
    })
  })
})
