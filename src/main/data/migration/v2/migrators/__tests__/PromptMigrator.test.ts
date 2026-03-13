import { describe, expect, it, vi } from 'vitest'

import type { MigrationContext } from '../../core/MigrationContext'
import { PromptMigrator } from '../PromptMigrator'

/** Helper: build a minimal MigrationContext mock */
function createMockContext(
  overrides: { tableExists?: boolean; tableData?: unknown[]; promptCount?: number; versionCount?: number } = {}
): MigrationContext {
  const { tableExists = true, tableData = [], promptCount = 0, versionCount = 0 } = overrides

  const insertFn = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockResolvedValue(undefined)
  }))

  // validate() calls select().from(promptTable).get() then select().from(promptVersionTable).get()
  let selectCallIndex = 0
  const counts = [promptCount, versionCount]
  const selectFn = vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      get: vi.fn().mockImplementation(() => {
        const count = counts[selectCallIndex] ?? 0
        selectCallIndex++
        return Promise.resolve({ count })
      })
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
      } as unknown as MigrationContext['sources']['dexieExport']
    },
    db: db as unknown as MigrationContext['db'],
    sharedData: new Map(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    } as unknown as MigrationContext['logger']
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

    it('should return failure when dexie read throws', async () => {
      const ctx = createMockContext()
      ;(ctx.sources.dexieExport.tableExists as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('read error'))
      const migrator = new PromptMigrator()

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(false)
      expect(result.warnings).toContain('read error')
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

    it('should insert prompt and version for each valid phrase', async () => {
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

    it('should return failure when transaction throws', async () => {
      const phrases = [makePhrase({ id: 'p1', content: 'c1' })]
      const ctx = createMockContext({ tableData: phrases })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      ;(ctx.db.transaction as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db error'))

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(false)
      expect(result.error).toBe('db error')
    })
  })

  // ── validate ─────────────────────────────────────────────────────

  describe('validate', () => {
    it('should succeed when counts match', async () => {
      const phrases = [makePhrase({ id: 'p1', content: 'c1' })]
      const ctx = createMockContext({
        tableData: phrases,
        promptCount: 1,
        versionCount: 1
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
        promptCount: 1, // less than source
        versionCount: 1
      })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.validate(ctx)

      expect(result.success).toBe(false)
      expect(result.errors.some((e) => e.key === 'prompt_count_mismatch')).toBe(true)
    })

    it('should report error when version count is less than prompt count', async () => {
      const phrases = [makePhrase({ id: 'p1', content: 'c1' })]
      const ctx = createMockContext({
        tableData: phrases,
        promptCount: 1,
        versionCount: 0 // no versions
      })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.validate(ctx)

      expect(result.success).toBe(false)
      expect(result.errors.some((e) => e.key === 'version_count_mismatch')).toBe(true)
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
        promptCount: 1,
        versionCount: 1
      })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.validate(ctx)

      expect(result.stats.skippedCount).toBe(1)
    })
  })
})
