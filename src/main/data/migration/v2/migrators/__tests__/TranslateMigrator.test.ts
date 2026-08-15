import { translateHistoryTable } from '@data/db/schemas/translateHistory'
import { translateLanguageTable } from '@data/db/schemas/translateLanguage'
import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import type { MigrationContext } from '../../core/MigrationContext'
import { TranslateMigrator } from '../TranslateMigrator'

// ─── Old data helpers ─────────────────────────────────────────────────

function makeHistoryRecord(
  overrides: Partial<{
    id: string
    sourceText: string
    targetText: string
    sourceLanguage: string
    targetLanguage: string
    createdAt: string
    star: boolean
  }> = {}
) {
  return {
    id: 'hist-1',
    sourceText: 'Hello',
    targetText: '你好',
    sourceLanguage: 'en-us',
    targetLanguage: 'zh-cn',
    createdAt: '2024-01-01T00:00:00.000Z',
    star: false,
    ...overrides
  }
}

function makeLanguageRecord(
  overrides: Partial<{
    id: string
    langCode: string
    value: string
    emoji: string
  }> = {}
) {
  return {
    id: 'lang-1',
    langCode: 'custom-xx',
    value: 'CustomLang',
    emoji: '🏴',
    ...overrides
  }
}

// ─── Mock context builder ─────────────────────────────────────────────

function createSourceMocks(
  overrides: {
    historyExists?: boolean
    historyData?: ReturnType<typeof makeHistoryRecord>[]
    languageExists?: boolean
    languageData?: ReturnType<typeof makeLanguageRecord>[]
  } = {}
) {
  const { historyExists = true, historyData = [], languageExists = true, languageData = [] } = overrides

  const tableExistsFn = vi.fn().mockImplementation((tableName: string) => {
    if (tableName === 'translate_history') return Promise.resolve(historyExists)
    if (tableName === 'translate_languages') return Promise.resolve(languageExists)
    return Promise.resolve(false)
  })

  const readTableFn = vi.fn().mockImplementation((tableName: string) => {
    if (tableName === 'translate_history') return Promise.resolve([...historyData])
    if (tableName === 'translate_languages') return Promise.resolve([...languageData])
    return Promise.resolve([])
  })

  return {
    dexieExport: {
      tableExists: tableExistsFn,
      readTable: readTableFn,
      getExportPath: vi.fn().mockReturnValue('/tmp/export'),
      createStreamReader: vi.fn(),
      getTableFileSize: vi.fn()
    }
  }
}

function buildContext(
  db: MigrationContext['db'],
  sourceOverrides: Parameters<typeof createSourceMocks>[0] = {}
): MigrationContext {
  const sources = createSourceMocks(sourceOverrides)

  return {
    sources: {
      electronStore: { get: vi.fn() },
      reduxState: {
        getCategory: vi.fn(),
        getAllCategories: vi.fn()
      } as unknown as MigrationContext['sources']['reduxState'],
      dexieExport: sources.dexieExport as unknown as MigrationContext['sources']['dexieExport'],
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
    db,
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

// ─── Tests ────────────────────────────────────────────────────────────

describe('TranslateMigrator', () => {
  const dbh = setupTestDatabase()

  describe('metadata', () => {
    it('should have correct metadata', () => {
      const migrator = new TranslateMigrator()
      expect(migrator.id).toBe('translate')
      expect(migrator.name).toBe('Translate')
      expect(migrator.order).toBe(5)
    })
  })

  // ── prepare ──────────────────────────────────────────────────────

  describe('prepare', () => {
    it('should return success with 0 items when both tables are missing', async () => {
      const ctx = buildContext(dbh.db, { historyExists: false, languageExists: false })
      const migrator = new TranslateMigrator()

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
      expect(result.warnings).toBeDefined()
      expect(result.warnings!.some((w) => w.includes('translate_history.json not found'))).toBe(true)
      expect(result.warnings!.some((w) => w.includes('translate_languages.json not found'))).toBe(true)
    })

    it('should warn when only history table is missing', async () => {
      const ctx = buildContext(dbh.db, {
        historyExists: false,
        languageExists: true,
        languageData: [makeLanguageRecord()]
      })
      const migrator = new TranslateMigrator()

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(1)
      expect(result.warnings).toBeDefined()
      expect(result.warnings!.some((w) => w.includes('translate_history.json not found'))).toBe(true)
    })

    it('should warn when only language table is missing', async () => {
      const ctx = buildContext(dbh.db, {
        historyExists: true,
        historyData: [makeHistoryRecord()],
        languageExists: false
      })
      const migrator = new TranslateMigrator()

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(1)
      expect(result.warnings!.some((w) => w.includes('translate_languages.json not found'))).toBe(true)
    })

    it('should count records from both tables', async () => {
      const ctx = buildContext(dbh.db, {
        historyData: [makeHistoryRecord({ id: 'h1' }), makeHistoryRecord({ id: 'h2' })],
        languageData: [makeLanguageRecord({ id: 'l1' })]
      })
      const migrator = new TranslateMigrator()

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(3)
      expect(result.warnings).toBeUndefined()
    })

    it('should handle empty tables', async () => {
      const ctx = buildContext(dbh.db, { historyData: [], languageData: [] })
      const migrator = new TranslateMigrator()

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('should surface prepare failure via warnings', async () => {
      const ctx = buildContext(dbh.db, { historyExists: true })
      ;(ctx.sources.dexieExport.tableExists as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('read error'))
      const migrator = new TranslateMigrator()

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(false)
      expect(result.itemCount).toBe(0)
      expect(result.warnings).toBeDefined()
      expect(result.warnings![0]).toContain('read error')
    })
  })

  // ── execute ──────────────────────────────────────────────────────

  describe('execute', () => {
    it('should return immediately when no records prepared', async () => {
      const ctx = buildContext(dbh.db, { historyExists: false, languageExists: false })
      const migrator = new TranslateMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(0)
    })

    it('should migrate custom language records', async () => {
      const ctx = buildContext(dbh.db, {
        languageData: [makeLanguageRecord({ id: 'l1', langCode: 'xx-YY', value: 'TestLang', emoji: '🏁' })],
        historyExists: false
      })
      const migrator = new TranslateMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(1)

      const rows = await dbh.db
        .select()
        .from(translateLanguageTable)
        .where(eq(translateLanguageTable.langCode, 'xx-YY'))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ langCode: 'xx-YY', value: 'TestLang', emoji: '🏁' })
      expect(rows[0].createdAt).toBeGreaterThan(0)
      expect(rows[0].updatedAt).toBeGreaterThan(0)
    })

    it('should skip invalid language records', async () => {
      const ctx = buildContext(dbh.db, {
        languageData: [
          makeLanguageRecord({ id: 'l1', langCode: 'valid-xx', value: 'Valid', emoji: '✅' }),
          makeLanguageRecord({ id: '', langCode: 'no-id-xx', value: 'NoId', emoji: '❌' }),
          makeLanguageRecord({ id: 'l2', langCode: '', value: 'NoCode', emoji: '❌' }),
          makeLanguageRecord({ id: 'l3', langCode: 'no-val-xx', value: '', emoji: '❌' }),
          makeLanguageRecord({ id: 'l4', langCode: 'no-emoji-xx', value: 'NoEmoji', emoji: '' })
        ],
        historyExists: false
      })
      const migrator = new TranslateMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(1)

      const rows = await dbh.db.select().from(translateLanguageTable)
      // Only the valid custom language + builtin languages from seeder
      const customRows = rows.filter((r) => r.langCode === 'valid-xx')
      expect(customRows).toHaveLength(1)
    })

    it('should migrate history records with timestamp conversion', async () => {
      const ctx = buildContext(dbh.db, {
        historyData: [
          makeHistoryRecord({
            id: 'h1',
            sourceText: 'Hello',
            targetText: '你好',
            sourceLanguage: 'en-us',
            targetLanguage: 'zh-cn',
            createdAt: '2024-06-15T12:00:00.000Z',
            star: true
          })
        ]
      })
      const migrator = new TranslateMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(1)

      const rows = await dbh.db.select().from(translateHistoryTable).where(eq(translateHistoryTable.id, 'h1'))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        id: 'h1',
        sourceText: 'Hello',
        targetText: '你好',
        star: true
      })
      // ISO string → integer timestamp
      expect(rows[0].createdAt).toBe(new Date('2024-06-15T12:00:00.000Z').getTime())
      expect(rows[0].updatedAt).toBe(rows[0].createdAt)
    })

    it('should default star to false when missing', async () => {
      const ctx = buildContext(dbh.db, {
        historyData: [makeHistoryRecord({ id: 'h1', star: undefined })]
      })
      const migrator = new TranslateMigrator()
      await migrator.prepare(ctx)

      await migrator.execute(ctx)

      const rows = await dbh.db.select().from(translateHistoryTable).where(eq(translateHistoryTable.id, 'h1'))
      expect(rows[0].star).toBe(false)
    })

    it('should fallback to Date.now() for invalid createdAt', async () => {
      const before = Date.now()
      const ctx = buildContext(dbh.db, {
        historyData: [makeHistoryRecord({ id: 'h1', createdAt: 'not-a-date' })]
      })
      const migrator = new TranslateMigrator()
      await migrator.prepare(ctx)

      await migrator.execute(ctx)

      const rows = await dbh.db.select().from(translateHistoryTable).where(eq(translateHistoryTable.id, 'h1'))
      expect(rows[0].createdAt).toBeGreaterThanOrEqual(before)
    })

    it('should skip invalid history records', async () => {
      const ctx = buildContext(dbh.db, {
        historyData: [
          makeHistoryRecord({ id: 'h1', sourceText: 'Valid', targetText: '有效' }),
          makeHistoryRecord({ id: '', sourceText: 'NoId', targetText: 'xxx' }),
          makeHistoryRecord({ id: 'h2', sourceText: '', targetText: 'NoSource' }),
          makeHistoryRecord({ id: 'h3', sourceText: 'NoTarget', targetText: '' })
        ]
      })
      const migrator = new TranslateMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      // Only h1 is valid; h2, h3 skipped for missing fields
      // Note: '' id is actually falsy, but it's still an id. The migrator checks `!old.id`.
      // Let me check... `!old.id` — '' is falsy, so it'll be skipped.
      expect(result.processedCount).toBe(1)

      const rows = await dbh.db.select().from(translateHistoryTable)
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe('h1')
    })

    it('should null-out FK references for unknown language codes', async () => {
      const ctx = buildContext(dbh.db, {
        historyData: [
          makeHistoryRecord({
            id: 'h1',
            sourceLanguage: 'xx-UNKNOWN-CODE',
            targetLanguage: 'yy-UNKNOWN-CODE'
          })
        ]
      })
      const migrator = new TranslateMigrator()
      await migrator.prepare(ctx)

      await migrator.execute(ctx)

      const rows = await dbh.db.select().from(translateHistoryTable).where(eq(translateHistoryTable.id, 'h1'))
      expect(rows[0].sourceLanguage).toBeNull()
      expect(rows[0].targetLanguage).toBeNull()
    })

    it('should migrate language records before history to satisfy FK order', async () => {
      const ctx = buildContext(dbh.db, {
        languageData: [makeLanguageRecord({ id: 'l1', langCode: 'test-L1', value: 'L1', emoji: '🔤' })],
        historyData: [
          makeHistoryRecord({
            id: 'h1',
            sourceLanguage: 'test-L1',
            targetLanguage: 'test-L1'
          })
        ]
      })
      const migrator = new TranslateMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(2)

      const historyRow = await dbh.db.select().from(translateHistoryTable).where(eq(translateHistoryTable.id, 'h1'))
      expect(historyRow[0].sourceLanguage).toBe('test-L1')
      expect(historyRow[0].targetLanguage).toBe('test-L1')
    })

    it('should report progress during migration', async () => {
      const histories = Array.from({ length: 5 }, (_, i) =>
        makeHistoryRecord({ id: `h${i}`, sourceText: `src${i}`, targetText: `tgt${i}` })
      )
      const ctx = buildContext(dbh.db, {
        historyData: histories,
        languageData: [makeLanguageRecord({ id: 'l1' })]
      })
      const migrator = new TranslateMigrator()
      const progressFn = vi.fn()
      migrator.setProgressCallback(progressFn)
      await migrator.prepare(ctx)

      await migrator.execute(ctx)

      expect(progressFn).toHaveBeenCalled()
      const lastCall = progressFn.mock.calls[progressFn.mock.calls.length - 1]
      expect(lastCall[0]).toBe(100)
    })

    it('should return failure when transaction throws', async () => {
      // Use a mock db that throws on transaction
      const ctx = buildContext(dbh.db, {
        historyData: [makeHistoryRecord({ id: 'h1' })]
      })
      const migrator = new TranslateMigrator()

      // Replace db with a mock that throws
      const mockDb = {
        transaction: vi.fn().mockRejectedValue(new Error('db error')),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockResolvedValue([])
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined)
        }),
        run: vi.fn().mockResolvedValue(undefined),
        all: vi.fn().mockResolvedValue([])
      }
      ctx.db = mockDb as unknown as MigrationContext['db']

      await migrator.prepare(ctx)

      // Rebuild sources since prepare cached data but reset was called...
      // Actually prepare already cached the data. Let me just run execute.
      const result = await migrator.execute(ctx)

      expect(result.success).toBe(false)
      expect(result.processedCount).toBe(0)
      expect(result.error).toContain('db error')
    })
  })

  // ── validate ─────────────────────────────────────────────────────

  describe('validate', () => {
    it('should succeed when counts match', async () => {
      const ctx = buildContext(dbh.db, {
        historyData: [makeHistoryRecord({ id: 'h1' })],
        languageData: [makeLanguageRecord({ id: 'l1' })]
      })
      const migrator = new TranslateMigrator()
      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      const result = await migrator.validate(ctx)

      expect(result.success).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.stats.sourceCount).toBe(2)
      expect(result.stats.targetCount).toBeGreaterThanOrEqual(2) // builtin languages also inserted
      expect(result.stats.skippedCount).toBe(0)
    })

    it('should report error when history count is less than expected', async () => {
      const ctx = buildContext(dbh.db, {
        historyData: [makeHistoryRecord({ id: 'h1' }), makeHistoryRecord({ id: 'h2' })]
      })
      const migrator = new TranslateMigrator()
      await migrator.prepare(ctx)
      // Don't execute — DB is empty, so target count is 0

      const result = await migrator.validate(ctx)

      expect(result.success).toBe(false)
      expect(result.errors.some((e) => e.key === 'history_count_mismatch')).toBe(true)
    })

    it('should track skipped count in stats', async () => {
      const ctx = buildContext(dbh.db, {
        historyData: [
          makeHistoryRecord({ id: 'h1', sourceText: 'Valid', targetText: 'OK' }),
          makeHistoryRecord({ id: '', sourceText: 'Bad', targetText: 'xx' }) // skipped
        ],
        languageExists: false
      })
      const migrator = new TranslateMigrator()
      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      const result = await migrator.validate(ctx)

      expect(result.stats.skippedCount).toBe(1)
    })

    it('should handle db query failure gracefully', async () => {
      const ctx = buildContext(dbh.db, {
        historyData: [makeHistoryRecord({ id: 'h1' })]
      })
      const migrator = new TranslateMigrator()
      await migrator.prepare(ctx)

      // Replace db with a mock that throws on select
      const mockDb = {
        select: vi.fn().mockImplementation(() => {
          throw new Error('query failed')
        })
      }
      ctx.db = mockDb as unknown as MigrationContext['db']

      const result = await migrator.validate(ctx)

      expect(result.success).toBe(false)
      expect(result.errors.some((e) => e.key === 'validation')).toBe(true)
      expect(result.errors[0].message).toContain('query failed')
    })
  })

  // ── reset ───────────────────────────────────────────────────────

  describe('reset', () => {
    it('should clear cached data and counters', async () => {
      const ctx = buildContext(dbh.db, {
        historyData: [makeHistoryRecord({ id: 'h1' })],
        languageData: [makeLanguageRecord({ id: 'l1' })]
      })
      const migrator = new TranslateMigrator()
      await migrator.prepare(ctx)
      // execute one run
      await migrator.execute(ctx)

      migrator.reset()

      // After reset, re-prepare should count fresh
      const ctx2 = buildContext(dbh.db, { historyExists: false, languageExists: false })
      const result = await migrator.prepare(ctx2)
      expect(result.itemCount).toBe(0)
    })
  })
})

// ─── SQLite integration tests ─────────────────────────────────────────

describe('TranslateMigrator SQLite integration', () => {
  const dbh = setupTestDatabase()

  it('should migrate both tables end-to-end with correct data', async () => {
    const ctx = buildContext(dbh.db, {
      languageData: [
        makeLanguageRecord({ id: 'l1', langCode: 'zz-TEST', value: 'TestLang', emoji: '🧪' }),
        makeLanguageRecord({ id: 'l2', langCode: 'zz-TEST2', value: 'TestLang2', emoji: '🧫' })
      ],
      historyData: [
        makeHistoryRecord({
          id: '550e8400-e29b-41d4-a716-446655440000',
          sourceText: 'Hello World',
          targetText: '你好世界',
          sourceLanguage: 'en-us',
          targetLanguage: 'zh-cn',
          createdAt: '2025-01-15T08:30:00.000Z',
          star: true
        }),
        makeHistoryRecord({
          id: '550e8400-e29b-41d4-a716-446655440001',
          sourceText: 'Good morning',
          targetText: '早上好',
          sourceLanguage: 'zz-TEST',
          targetLanguage: 'zz-TEST2',
          createdAt: '2025-02-20T14:00:00.000Z',
          star: false
        }),
        makeHistoryRecord({
          id: '550e8400-e29b-41d4-a716-446655440002',
          sourceText: 'Third entry',
          targetText: '第三条',
          sourceLanguage: 'en-us',
          targetLanguage: 'zz-TEST',
          createdAt: '2025-03-10T00:00:00.000Z'
        })
      ]
    })
    const migrator = new TranslateMigrator()

    const prepareResult = await migrator.prepare(ctx)
    const executeResult = await migrator.execute(ctx)
    const validateResult = await migrator.validate(ctx)

    expect(prepareResult).toMatchObject({ success: true, itemCount: 5 })
    expect(executeResult).toMatchObject({ success: true, processedCount: 5 })
    expect(validateResult.success).toBe(true)

    // Verify history records
    const historyRows = await dbh.db.select().from(translateHistoryTable).orderBy(asc(translateHistoryTable.createdAt))

    expect(historyRows).toHaveLength(3)
    expect(historyRows[0].id).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(historyRows[0].sourceText).toBe('Hello World')
    expect(historyRows[0].targetText).toBe('你好世界')
    expect(historyRows[0].sourceLanguage).toBe('en-us')
    expect(historyRows[0].targetLanguage).toBe('zh-cn')
    expect(historyRows[0].star).toBe(true)
    expect(historyRows[0].createdAt).toBe(new Date('2025-01-15T08:30:00.000Z').getTime())

    expect(historyRows[1].sourceLanguage).toBe('zz-TEST')
    expect(historyRows[1].targetLanguage).toBe('zz-TEST2')
    expect(historyRows[1].star).toBe(false)

    expect(historyRows[2].sourceLanguage).toBe('en-us')
    expect(historyRows[2].targetLanguage).toBe('zz-TEST')
    expect(historyRows[2].star).toBe(false) // default when missing

    // Verify language records
    const langRows = await dbh.db.select().from(translateLanguageTable)
    const customLangs = langRows.filter((r) => r.langCode.startsWith('zz-TEST'))
    expect(customLangs).toHaveLength(2)
    expect(customLangs.map((r) => r.langCode).sort()).toEqual(['zz-TEST', 'zz-TEST2'])
  })

  it('should handle empty history gracefully when languages exist', async () => {
    const ctx = buildContext(dbh.db, {
      languageData: [makeLanguageRecord({ id: 'l1', langCode: 'only-lang', value: 'Only', emoji: '1️⃣' })],
      historyExists: false
    })
    const migrator = new TranslateMigrator()

    const prepareResult = await migrator.prepare(ctx)
    const executeResult = await migrator.execute(ctx)
    const validateResult = await migrator.validate(ctx)

    expect(prepareResult).toMatchObject({ success: true, itemCount: 1 })
    expect(executeResult).toMatchObject({ success: true, processedCount: 1 })
    expect(validateResult.success).toBe(true)

    const langRows = await dbh.db
      .select()
      .from(translateLanguageTable)
      .where(eq(translateLanguageTable.langCode, 'only-lang'))
    expect(langRows).toHaveLength(1)

    const historyRows = await dbh.db.select().from(translateHistoryTable)
    expect(historyRows).toHaveLength(0)
  })

  it('should handle empty languages gracefully when history exists', async () => {
    const ctx = buildContext(dbh.db, {
      languageExists: false,
      historyData: [
        makeHistoryRecord({
          id: 'hist-no-lang',
          sourceLanguage: 'en-us',
          targetLanguage: 'zh-cn'
        })
      ]
    })
    const migrator = new TranslateMigrator()

    const prepareResult = await migrator.prepare(ctx)
    const executeResult = await migrator.execute(ctx)
    const validateResult = await migrator.validate(ctx)

    expect(prepareResult).toMatchObject({ success: true, itemCount: 1 })
    expect(executeResult).toMatchObject({ success: true, processedCount: 1 })
    expect(validateResult.success).toBe(true)

    // History FK should reference builtin languages seeded by TranslateLanguageSeeder
    const historyRows = await dbh.db.select().from(translateHistoryTable)
    expect(historyRows).toHaveLength(1)
    // en-US and zh-CN are builtin codes seeded by TranslateLanguageSeeder
    expect(historyRows[0].sourceLanguage).toBe('en-us')
    expect(historyRows[0].targetLanguage).toBe('zh-cn')
  })
})
