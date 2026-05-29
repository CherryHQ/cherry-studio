import { promptTable } from '@data/db/schemas/prompt'
import { setupTestDatabase } from '@test-helpers/db'
import { asc } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import type { MigrationContext } from '../../core/MigrationContext'
import { PromptMigrator } from '../PromptMigrator'

/** Helper: build a minimal MigrationContext mock */
function createMockContext(
  overrides: { tableExists?: boolean; tableData?: unknown[]; promptCount?: number } = {}
): MigrationContext {
  const { tableExists = true, tableData = [], promptCount = 0 } = overrides

  const insertFn = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockResolvedValue(undefined)
  }))

  const selectFn = vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      get: vi.fn().mockResolvedValue({ count: promptCount })
    }))
  }))

  const txProxy = new Proxy(
    { insert: insertFn },
    {
      get(_target, prop) {
        if (prop === 'insert') return insertFn
        return undefined
      }
    }
  )

  const db = {
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn(txProxy)
    }),
    select: selectFn
  }

  return {
    sources: {
      electronStore: { get: vi.fn() },
      reduxState: {
        getCategory: vi.fn(),
        getAllCategories: vi.fn()
      } as unknown as MigrationContext['sources']['reduxState'],
      dexieExport: {
        tableExists: vi.fn().mockResolvedValue(tableExists),
        readTable: vi.fn().mockResolvedValue(tableData),
        getExportPath: vi.fn().mockReturnValue('/tmp/export'),
        createStreamReader: vi.fn(),
        getTableFileSize: vi.fn()
      } as unknown as MigrationContext['sources']['dexieExport'],
      dexieSettings: {
        get: vi.fn(),
        getAll: vi.fn()
      } as unknown as MigrationContext['sources']['dexieSettings'],
      localStorage: {
        get: vi.fn(),
        getAll: vi.fn()
      } as unknown as MigrationContext['sources']['localStorage'],
      knowledgeVectorSource: {} as unknown as MigrationContext['sources']['knowledgeVectorSource'],
      legacyHomeConfig: {} as unknown as MigrationContext['sources']['legacyHomeConfig']
    },
    db: db as unknown as MigrationContext['db'],
    sharedData: new Map(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    } as unknown as MigrationContext['logger'],
    paths: {} as unknown as MigrationContext['paths']
  }
}

/** Helper: build a legacy QuickPhrase record */
function makePhrase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'phrase-1',
    title: 'Hello',
    content: 'Hello ${name}!',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    order: 0,
    ...overrides
  }
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('PromptMigrator', () => {
  describe('metadata', () => {
    it('should have correct metadata', () => {
      const migrator = new PromptMigrator()
      expect(migrator.id).toBe('prompt')
      expect(migrator.name).toBe('Prompts')
      expect(migrator.order).toBe(5.5)
    })
  })

  // ── prepare ──────────────────────────────────────────────────────

  describe('prepare', () => {
    it('should return success with 0 items when table does not exist', async () => {
      const ctx = createMockContext({ tableExists: false })
      const migrator = new PromptMigrator()

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
      expect(result.warnings).toContain('quick_phrases table not found - skipping')
    })

    it('should count phrases with content and finite timestamps', async () => {
      const ctx = createMockContext({
        tableData: [
          makePhrase({ id: 'a', content: 'valid' }),
          makePhrase({ id: undefined, content: 'missing id' }), // valid: id is regenerated during execute
          makePhrase({ id: 'b', content: '' }), // invalid: empty content
          makePhrase({ id: 'bad-created-at', content: 'bad timestamp', createdAt: Number.NaN }),
          makePhrase({ id: 'bad-updated-at', content: 'bad timestamp', updatedAt: Number.POSITIVE_INFINITY }),
          makePhrase({ id: 'c', content: 'also valid' })
        ]
      })
      const migrator = new PromptMigrator()

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(3)
      expect(result.warnings?.[0]).toMatch(/Skipped 3/)
    })

    it('should handle empty table', async () => {
      const ctx = createMockContext({ tableData: [] })
      const migrator = new PromptMigrator()

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('should surface prepare failures via the error field (not warnings)', async () => {
      const ctx = createMockContext()
      ;(ctx.sources.dexieExport.tableExists as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('read error'))
      const migrator = new PromptMigrator()

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(false)
      expect(result.error).toBe('read error')
      expect(result.warnings).toBeUndefined()
    })
  })

  // ── execute ──────────────────────────────────────────────────────

  describe('execute', () => {
    it('should return immediately when no phrases prepared', async () => {
      const ctx = createMockContext({ tableExists: false })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(0)
      expect(ctx.db.transaction).not.toHaveBeenCalled()
    })

    it('should insert one prompt for each valid phrase', async () => {
      const phrases = [
        makePhrase({ id: 'p1', title: 'First', content: 'c1', order: 0 }),
        makePhrase({ id: 'p2', title: 'Second', content: 'c2', order: 1 })
      ]
      const ctx = createMockContext({ tableData: phrases })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(2)
      // transaction should be called once (all inserts in one tx)
      expect(ctx.db.transaction).toHaveBeenCalledTimes(1)
    })

    it('should default title to Untitled when missing', async () => {
      const phrases = [makePhrase({ id: 'p1', title: '', content: 'c1' })]
      const ctx = createMockContext({ tableData: phrases })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      // Capture insert calls
      const insertCalls: unknown[] = []
      const mockInsert = vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((val: unknown) => {
          insertCalls.push(val)
          return Promise.resolve()
        })
      }))

      ;(ctx.db.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (fn: (tx: unknown) => Promise<void>) => {
          await fn({ insert: mockInsert })
        }
      )

      await migrator.execute(ctx)

      // First insert call is the prompt row
      const [promptRow] = insertCalls[0] as Array<Record<string, unknown>>
      expect(promptRow.title).toBe('Untitled')
    })

    it('should preserve legacy quick phrase order', async () => {
      const phrases = [
        makePhrase({ id: 'p-old', title: 'Older', content: 'old', order: 20 }),
        makePhrase({ id: 'p-new', title: 'Newer', content: 'new', order: 10 })
      ]
      const ctx = createMockContext({ tableData: phrases })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      const insertCalls: unknown[] = []
      const mockInsert = vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((val: Record<string, unknown>) => {
          insertCalls.push(val)
          return Promise.resolve()
        })
      }))

      ;(ctx.db.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (fn: (tx: unknown) => Promise<void>) => {
          await fn({ insert: mockInsert })
        }
      )

      await migrator.execute(ctx)

      const rows = insertCalls[0] as Array<Record<string, unknown>>
      expect(rows.map((row) => row.title)).toEqual(['Older', 'Newer'])
      expect(String(rows[0].orderKey) < String(rows[1].orderKey)).toBe(true)
    })

    it('should report progress', async () => {
      const phrases = Array.from({ length: 15 }, (_, i) => makePhrase({ id: `p${i}`, content: `c${i}` }))
      const ctx = createMockContext({ tableData: phrases })
      const migrator = new PromptMigrator()
      const progressFn = vi.fn()
      migrator.setProgressCallback(progressFn)
      await migrator.prepare(ctx)

      await migrator.execute(ctx)

      expect(progressFn).toHaveBeenCalledTimes(2)
      expect(progressFn.mock.calls[0][0]).toBe(67)
      expect(progressFn.mock.calls[0][1]).toMatchObject({ message: 'Migrated 10/15 prompts' })
      expect(progressFn.mock.calls[1][0]).toBe(100)
      expect(progressFn.mock.calls[1][1]).toMatchObject({ message: 'Migrated 15/15 prompts' })
    })

    it('should return failure and reset processedCount to 0 when transaction throws', async () => {
      const phrases = [makePhrase({ id: 'p1', content: 'c1' })]
      const ctx = createMockContext({ tableData: phrases })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      ;(ctx.db.transaction as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db error'))

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(false)
      expect(result.error).toContain('db error')
      // Rolled-back transaction means zero rows committed — processedCount reflects persisted state.
      expect(result.processedCount).toBe(0)
    })

    it('should surface a constraint violation mid-batch and reset processedCount', async () => {
      const phrases = [
        makePhrase({ id: 'phrase-a', content: 'first' }),
        makePhrase({ id: 'phrase-b', content: 'second' })
      ]
      const ctx = createMockContext({ tableData: phrases })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      // Simulate a DB-level failure from the bulk insert path (any
      // SQLITE_CONSTRAINT, FK mismatch, etc.).
      const insertFn = vi.fn().mockImplementation(() => ({
        values: vi.fn().mockRejectedValue(new Error('UNIQUE constraint failed: prompt.id'))
      }))

      ;(ctx.db.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (fn: (tx: unknown) => Promise<void>) => {
          await fn({ insert: insertFn })
        }
      )

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(false)
      expect(result.error).toContain('source row 0')
      expect(result.error).toContain('UNIQUE')
      expect(result.processedCount).toBe(0)
    })

    it('should preserve the legacy quick phrase id', async () => {
      const legacyId = '550e8400-e29b-41d4-a716-446655440000'
      const phrases = [makePhrase({ id: legacyId, content: 'c1' })]
      const ctx = createMockContext({ tableData: phrases })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      const insertCalls: unknown[] = []
      const insertFn = vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation((val: Record<string, unknown>) => {
          insertCalls.push(val)
          return Promise.resolve(undefined)
        })
      }))
      ;(ctx.db.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (fn: (tx: unknown) => Promise<void>) => {
          await fn({ insert: insertFn })
        }
      )

      await migrator.execute(ctx)

      const [promptRow] = insertCalls[0] as Array<Record<string, unknown>>
      expect(promptRow.id).toBe(legacyId)
      expect(insertCalls[0] as unknown[]).toHaveLength(1)
    })
  })

  // ── end-to-end: execute failure then validate ───────────────────
  describe('execute failure → validate', () => {
    it('should report count mismatch in validate() when execute rolled back', async () => {
      const phrases = [makePhrase({ id: 'p1', content: 'c1' })]
      const ctx = createMockContext({
        tableData: phrases,
        // DB reports zero rows because the execute transaction rolled back.
        promptCount: 0
      })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      ;(ctx.db.transaction as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('forced rollback'))
      const executeResult = await migrator.execute(ctx)
      expect(executeResult.success).toBe(false)
      expect(executeResult.processedCount).toBe(0)

      const validateResult = await migrator.validate(ctx)
      expect(validateResult.success).toBe(false)
      expect(validateResult.errors.some((e) => e.key === 'prompt_count_mismatch')).toBe(true)
      expect(validateResult.stats.targetCount).toBe(0)
    })
  })

  // ── validate ─────────────────────────────────────────────────────

  describe('validate', () => {
    it('should succeed when counts match', async () => {
      const phrases = [makePhrase({ id: 'p1', content: 'c1' })]
      const ctx = createMockContext({
        tableData: phrases,
        promptCount: 1
      })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.validate(ctx)

      expect(result.success).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.stats.sourceCount).toBe(1)
      expect(result.stats.targetCount).toBe(1)
    })

    it('should report error when prompt count is less than expected', async () => {
      const phrases = [makePhrase({ id: 'p1', content: 'c1' }), makePhrase({ id: 'p2', content: 'c2' })]
      const ctx = createMockContext({
        tableData: phrases,
        promptCount: 1 // less than source
      })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.validate(ctx)

      expect(result.success).toBe(false)
      expect(result.errors.some((e) => e.key === 'prompt_count_mismatch')).toBe(true)
    })

    it('should handle db query failure gracefully', async () => {
      const phrases = [makePhrase({ id: 'p1', content: 'c1' })]
      const ctx = createMockContext({ tableData: phrases })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      ;(ctx.db as unknown as { select: ReturnType<typeof vi.fn> }).select.mockImplementation(() => {
        throw new Error('query failed')
      })

      const result = await migrator.validate(ctx)

      expect(result.success).toBe(false)
      expect(result.errors.some((e) => e.key === 'validation_error')).toBe(true)
    })

    it('should track skipped count in stats', async () => {
      const phrases = [
        makePhrase({ id: 'p1', content: 'valid' }),
        makePhrase({ id: 'p2', content: '' }) // skipped
      ]
      const ctx = createMockContext({
        tableData: phrases,
        promptCount: 1
      })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.validate(ctx)

      expect(result.stats.skippedCount).toBe(1)
    })
  })
})

describe('PromptMigrator SQLite integration', () => {
  const dbh = setupTestDatabase()

  it('migrates quick phrases into the real prompt table with order keys', async () => {
    const ctx = createMockContext({
      tableData: [
        makePhrase({ id: '550e8400-e29b-41d4-a716-446655440000', title: 'Older', content: 'old ${name}', order: 2 }),
        makePhrase({ id: '550e8400-e29b-41d4-a716-446655440001', title: 'Newer', content: 'new', order: 1 })
      ]
    })
    ctx.db = dbh.db
    const migrator = new PromptMigrator()

    const prepareResult = await migrator.prepare(ctx)
    const executeResult = await migrator.execute(ctx)
    const validateResult = await migrator.validate(ctx)

    const rows = await dbh.db.select().from(promptTable).orderBy(asc(promptTable.orderKey))

    expect(prepareResult).toMatchObject({ success: true, itemCount: 2 })
    expect(executeResult).toMatchObject({ success: true, processedCount: 2 })
    expect(validateResult.success).toBe(true)
    expect(rows.map((row) => row.title)).toEqual(['Older', 'Newer'])
    expect(rows.map((row) => row.id)).toEqual([
      '550e8400-e29b-41d4-a716-446655440000',
      '550e8400-e29b-41d4-a716-446655440001'
    ])
    expect(rows[0].orderKey < rows[1].orderKey).toBe(true)
  })
})
