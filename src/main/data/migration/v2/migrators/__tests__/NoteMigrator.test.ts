import fs from 'fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NoteMigrator } from '../NoteMigrator'

vi.mock('fs/promises')
vi.mock('@main/utils/file', () => ({
  getNotesDir: () => '/default/notes'
}))

const mockFs = vi.mocked(fs)

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

function mockDirEntries(entries: Array<{ name: string; isDir: boolean }>) {
  return entries.map((e) => ({
    name: e.name,
    isDirectory: () => e.isDir,
    isFile: () => !e.isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    path: '',
    parentPath: ''
  }))
}

describe('NoteMigrator', () => {
  let migrator: NoteMigrator

  beforeEach(() => {
    migrator = new NoteMigrator()
    migrator.setProgressCallback(vi.fn())
    vi.resetAllMocks()
  })

  describe('metadata', () => {
    it('should have correct id and order', () => {
      expect(migrator.id).toBe('note')
      expect(migrator.order).toBe(5)
    })
  })

  describe('prepare', () => {
    it('should return 0 when notes directory does not exist', async () => {
      const { ctx } = createMockContext({ note: { notesPath: '/nonexistent', starredPaths: [] } })
      mockFs.access.mockRejectedValue(new Error('ENOENT'))

      const result = await migrator.prepare(ctx as never)
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('should use default notesDir when Redux notesPath is empty', async () => {
      const { ctx } = createMockContext({ note: { notesPath: '', starredPaths: [] } })
      mockFs.access.mockResolvedValue(undefined)
      mockFs.readdir.mockResolvedValue(mockDirEntries([{ name: 'a.md', isDir: false }]) as never)

      const result = await migrator.prepare(ctx as never)
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(1)
      // Used /default/notes from getNotesDir()
      expect(mockFs.access).toHaveBeenCalledWith('/default/notes')
    })

    it('should scan .md files recursively', async () => {
      const { ctx } = createMockContext({ note: { notesPath: '/notes', starredPaths: [] } })
      mockFs.access.mockResolvedValue(undefined)
      // Root dir has a.md and a subfolder
      mockFs.readdir
        .mockResolvedValueOnce(
          mockDirEntries([
            { name: 'a.md', isDir: false },
            { name: 'sub', isDir: true }
          ]) as never
        )
        // Sub dir has b.md
        .mockResolvedValueOnce(mockDirEntries([{ name: 'b.md', isDir: false }]) as never)

      const result = await migrator.prepare(ctx as never)
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(2)
    })

    it('should ignore non-md files', async () => {
      const { ctx } = createMockContext({ note: { notesPath: '/notes', starredPaths: [] } })
      mockFs.access.mockResolvedValue(undefined)
      mockFs.readdir.mockResolvedValue(
        mockDirEntries([
          { name: 'a.md', isDir: false },
          { name: 'b.txt', isDir: false },
          { name: 'c.pdf', isDir: false }
        ]) as never
      )

      const result = await migrator.prepare(ctx as never)
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(1)
    })

    it('should collect starred paths for lookup', async () => {
      const { ctx } = createMockContext({
        note: { notesPath: '/notes', starredPaths: ['/notes/a.md', '/notes/b.md'] }
      })
      mockFs.access.mockResolvedValue(undefined)
      mockFs.readdir.mockResolvedValue(
        mockDirEntries([
          { name: 'a.md', isDir: false },
          { name: 'b.md', isDir: false },
          { name: 'c.md', isDir: false }
        ]) as never
      )

      const result = await migrator.prepare(ctx as never)
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(3)
    })
  })

  describe('execute', () => {
    it('should return 0 when no files to migrate', async () => {
      const { ctx } = createMockContext({ note: { notesPath: '/notes', starredPaths: [] } })
      mockFs.access.mockRejectedValue(new Error('ENOENT'))

      await migrator.prepare(ctx as never)
      const result = await migrator.execute(ctx as never)
      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(0)
    })

    it('should insert all files with correct isStarred', async () => {
      const { ctx, mocks } = createMockContext({
        note: { notesPath: '/notes', starredPaths: ['/notes/a.md'] }
      })
      mockFs.access.mockResolvedValue(undefined)
      mockFs.readdir.mockResolvedValue(
        mockDirEntries([
          { name: 'a.md', isDir: false },
          { name: 'b.md', isDir: false }
        ]) as never
      )

      await migrator.prepare(ctx as never)
      const result = await migrator.execute(ctx as never)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(2)
      expect(mocks.insertValues).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ relativePath: 'a.md', isStarred: true }),
          expect.objectContaining({ relativePath: 'b.md', isStarred: false })
        ])
      )
    })

    it('should compute relative paths for nested files', async () => {
      const { ctx, mocks } = createMockContext({
        note: { notesPath: '/notes', starredPaths: [] }
      })
      mockFs.access.mockResolvedValue(undefined)
      mockFs.readdir
        .mockResolvedValueOnce(mockDirEntries([{ name: 'sub', isDir: true }]) as never)
        .mockResolvedValueOnce(mockDirEntries([{ name: 'deep.md', isDir: false }]) as never)

      await migrator.prepare(ctx as never)
      await migrator.execute(ctx as never)

      expect(mocks.insertValues).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ relativePath: 'sub/deep.md' })])
      )
    })
  })

  describe('validate', () => {
    it('should pass when counts match', async () => {
      const { ctx, mocks } = createMockContext({
        note: { notesPath: '/notes', starredPaths: [] }
      })
      mockFs.access.mockResolvedValue(undefined)
      mockFs.readdir.mockResolvedValue(
        mockDirEntries([
          { name: 'a.md', isDir: false },
          { name: 'b.md', isDir: false }
        ]) as never
      )
      mocks.selectFromGet.mockResolvedValue({ count: 2 })

      await migrator.prepare(ctx as never)
      const result = await migrator.validate(ctx as never)

      expect(result.success).toBe(true)
      expect(result.stats.sourceCount).toBe(2)
      expect(result.stats.targetCount).toBe(2)
    })

    it('should pass with 0 items', async () => {
      const { ctx, mocks } = createMockContext({})
      mockFs.access.mockRejectedValue(new Error('ENOENT'))
      mocks.selectFromGet.mockResolvedValue({ count: 0 })

      await migrator.prepare(ctx as never)
      const result = await migrator.validate(ctx as never)

      expect(result.success).toBe(true)
      expect(result.stats.sourceCount).toBe(0)
      expect(result.stats.targetCount).toBe(0)
    })

    it('should handle db error gracefully', async () => {
      const { ctx, mocks } = createMockContext({
        note: { notesPath: '/notes', starredPaths: [] }
      })
      mockFs.access.mockResolvedValue(undefined)
      mockFs.readdir.mockResolvedValue(mockDirEntries([{ name: 'a.md', isDir: false }]) as never)
      mocks.selectFromGet.mockRejectedValue(new Error('DB error'))

      await migrator.prepare(ctx as never)
      const result = await migrator.validate(ctx as never)

      expect(result.success).toBe(false)
      expect(result.errors).toHaveLength(1)
    })
  })
})
