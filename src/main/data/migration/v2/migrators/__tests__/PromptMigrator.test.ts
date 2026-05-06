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
      expect(migrator.order).toBe(5)
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

    it('should count valid phrases and skip invalid ones', async () => {
      const ctx = createMockContext({
        tableData: [
          makePhrase({ id: 'a', content: 'valid' }),
          makePhrase({ id: '', content: 'missing id' }), // invalid: empty id
          makePhrase({ id: 'b', content: '' }), // invalid: empty content
          makePhrase({ id: 'c', content: 'also valid' })
        ]
      })
      const migrator = new PromptMigrator()

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(2)
      expect(result.warnings?.[0]).toMatch(/Skipped 2/)
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
      const promptRow = insertCalls[0] as Record<string, unknown>
      expect(promptRow.title).toBe('Untitled')
    })

    it('should preserve legacy quick phrase order', async () => {
      const phrases = [
        makePhrase({ id: 'p-late', title: 'Late', content: 'late', order: 20 }),
        makePhrase({ id: 'p-early', title: 'Early', content: 'early', order: 10 })
      ]
      const ctx = createMockContext({ tableData: phrases })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      const insertCalls: Array<Record<string, unknown>> = []
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

      expect(insertCalls.map((row) => row.title)).toEqual(['Early', 'Late'])
      expect(String(insertCalls[0].orderKey) < String(insertCalls[1].orderKey)).toBe(true)
    })

    it('should report progress', async () => {
      const phrases = Array.from({ length: 15 }, (_, i) => makePhrase({ id: `p${i}`, content: `c${i}` }))
      const ctx = createMockContext({ tableData: phrases })
      const migrator = new PromptMigrator()
      const progressFn = vi.fn()
      migrator.setProgressCallback(progressFn)
      await migrator.prepare(ctx)

      await migrator.execute(ctx)

      // Progress reported at 10 and 15
      expect(progressFn).toHaveBeenCalled()
    })

    it('should return failure and reset processedCount to 0 when transaction throws', async () => {
      const phrases = [makePhrase({ id: 'p1', content: 'c1' })]
      const ctx = createMockContext({ tableData: phrases })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      ;(ctx.db.transaction as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db error'))

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(false)
      expect(result.error).toBe('db error')
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

      // Simulate a DB-level failure on the second prompt insert to cover
      // mid-batch rollback paths (any SQLITE_CONSTRAINT, FK mismatch, etc.).
      let insertCount = 0
      const insertFn = vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation(() => {
          insertCount++
          if (insertCount === 2) return Promise.reject(new Error('UNIQUE constraint failed: prompt.id'))
          return Promise.resolve(undefined)
        })
      }))

      ;(ctx.db.transaction as ReturnType<typeof vi.fn>).mockImplementation(
        async (fn: (tx: unknown) => Promise<void>) => {
          await fn({ insert: insertFn })
        }
      )

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(false)
      expect(result.error).toContain('UNIQUE')
      expect(result.processedCount).toBe(0)
    })

    it('should regenerate prompt.id as uuidv7 instead of preserving the legacy uuidv4', async () => {
      const phrases = [makePhrase({ id: 'legacy-v4-id', content: 'c1' })]
      const ctx = createMockContext({ tableData: phrases })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      const insertCalls: Array<Record<string, unknown>> = []
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

      const [promptRow] = insertCalls
      const uuidv7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      expect(promptRow.id).toMatch(uuidv7Pattern)
      expect(promptRow.id).not.toBe('legacy-v4-id')
      expect(insertCalls).toHaveLength(1)
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
        makePhrase({ id: '', content: 'invalid' }) // skipped
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
