import { promptTable } from '@data/db/schemas/prompt'
import { PROMPT_TITLE_MAX, PromptIdSchema } from '@shared/data/types/prompt'
import { setupTestDatabase } from '@test-helpers/db'
import { asc } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import type { MigrationContext } from '../../core/MigrationContext'
import { PromptMigrator } from '../PromptMigrator'

/** Helper: build a minimal MigrationContext mock */
function createMockContext(
  overrides: {
    tableExists?: boolean
    tableData?: unknown[]
    promptCount?: number
    promptRows?: unknown[]
    assistantState?: unknown
  } = {}
): MigrationContext {
  const { tableExists = true, tableData = [], promptCount = 0, promptRows = [], assistantState } = overrides

  const insertFn = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockImplementation(() => ({ run: vi.fn() }))
  }))

  const selectFn = vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      get: vi.fn().mockReturnValue({ count: promptCount }),
      all: vi.fn().mockReturnValue(promptRows)
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
    transaction: vi.fn().mockImplementation((fn: (tx: unknown) => void) => {
      fn(txProxy)
    }),
    select: selectFn
  }

  return {
    sources: {
      electronStore: { get: vi.fn() },
      reduxState: {
        getCategory: vi.fn((category: string) => (category === 'assistants' ? assistantState : undefined)),
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

function makeUuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

function captureInsertedRows(ctx: MigrationContext): Array<Array<Record<string, unknown>>> {
  const batches: Array<Array<Record<string, unknown>>> = []
  const insertFn = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockImplementation((rows: Array<Record<string, unknown>>) => {
      batches.push(rows)
      return { run: vi.fn() }
    })
  }))

  ;(ctx.db.transaction as ReturnType<typeof vi.fn>).mockImplementation((fn: (tx: unknown) => void) => {
    fn({ insert: insertFn })
  })

  return batches
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
    })

    it('should retain valid phrases and skip invalid content', async () => {
      const ctx = createMockContext({
        tableData: [
          makePhrase({ id: 'a', content: 'valid' }),
          makePhrase({ id: undefined, content: 'missing id' }), // valid: id is regenerated during prepare
          makePhrase({ id: 'b', content: '' }), // invalid: empty content
          makePhrase({ id: 'bad-created-at', content: 'bad timestamp', createdAt: Number.NaN }),
          makePhrase({ id: 'bad-updated-at', content: 'bad timestamp', updatedAt: Number.MAX_VALUE }),
          makePhrase({ id: 'c', content: 'also valid' })
        ]
      })
      const migrator = new PromptMigrator()

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(5)
    })

    it('should handle empty table', async () => {
      const ctx = createMockContext({ tableData: [] })
      const migrator = new PromptMigrator()

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('should prepare assistant phrases when the Dexie table does not exist', async () => {
      const ctx = createMockContext({
        tableExists: false,
        assistantState: {
          assistants: [
            {
              id: 'assistant-1',
              regularPhrases: [makePhrase({ id: '550e8400-e29b-41d4-a716-446655440010' })]
            }
          ],
          presets: []
        }
      })
      const migrator = new PromptMigrator()

      const result = await migrator.prepare(ctx)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(1)
    })

    it('should collect phrases from assistants, presets, and the default assistant', async () => {
      const ctx = createMockContext({
        assistantState: {
          assistants: [
            {
              id: 'assistant-1',
              regularPhrases: [makePhrase({ id: '550e8400-e29b-41d4-a716-446655440011' })]
            }
          ],
          presets: [
            {
              id: 'preset-1',
              regularPhrases: [makePhrase({ id: '550e8400-e29b-41d4-a716-446655440012' })]
            }
          ],
          defaultAssistant: {
            id: 'default',
            regularPhrases: [makePhrase({ id: '550e8400-e29b-41d4-a716-446655440013' })]
          }
        }
      })
      const migrator = new PromptMigrator()

      const result = await migrator.prepare(ctx)

      expect(result).toStrictEqual({ success: true, itemCount: 3 })
    })

    it('should count a non-array regularPhrases container as skipped', async () => {
      const ctx = createMockContext({
        promptCount: 0,
        assistantState: {
          assistants: [
            {
              id: 'assistant-1',
              regularPhrases: makePhrase({ content: 'hidden by malformed container' })
            }
          ],
          presets: []
        }
      })
      const migrator = new PromptMigrator()

      const prepareResult = await migrator.prepare(ctx)
      const validateResult = await migrator.validate(ctx)

      expect(prepareResult.itemCount).toBe(0)
      expect(validateResult.success).toBe(true)
      expect(validateResult.stats).toMatchObject({ sourceCount: 1, targetCount: 0, skippedCount: 1 })
    })

    it('should keep imported assistant phrases that omit timestamps', async () => {
      const ctx = createMockContext({
        assistantState: {
          assistants: [],
          presets: [
            {
              id: 'preset-1',
              regularPhrases: [
                {
                  id: '550e8400-e29b-41d4-a716-446655440014',
                  title: 'Imported',
                  content: 'Imported content'
                }
              ]
            }
          ]
        }
      })
      const batches = captureInsertedRows(ctx)
      const migrator = new PromptMigrator()

      const prepareResult = await migrator.prepare(ctx)
      const executeResult = await migrator.execute(ctx)

      expect(prepareResult.itemCount).toBe(1)
      expect(executeResult.processedCount).toBe(1)
      expect(batches[0][0]).toMatchObject({ title: 'Imported', content: 'Imported content' })
      expect(Number.isFinite(batches[0][0].createdAt)).toBe(true)
      expect(Number.isFinite(batches[0][0].updatedAt)).toBe(true)
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
          return { run: vi.fn() }
        })
      }))

      ;(ctx.db.transaction as ReturnType<typeof vi.fn>).mockImplementation((fn: (tx: unknown) => void) => {
        fn({ insert: mockInsert })
      })

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
          return { run: vi.fn() }
        })
      }))

      ;(ctx.db.transaction as ReturnType<typeof vi.fn>).mockImplementation((fn: (tx: unknown) => void) => {
        fn({ insert: mockInsert })
      })

      await migrator.execute(ctx)

      const rows = insertCalls[0] as Array<Record<string, unknown>>
      expect(rows.map((row) => row.title)).toEqual(['Older', 'Newer'])
      expect(String(rows[0].orderKey) < String(rows[1].orderKey)).toBe(true)
    })

    it('should append assistant phrases after the ordered global phrases', async () => {
      const ctx = createMockContext({
        tableData: [
          makePhrase({
            id: '550e8400-e29b-41d4-a716-446655440020',
            title: 'Global newer',
            content: 'global newer',
            order: 1
          }),
          makePhrase({
            id: '550e8400-e29b-41d4-a716-446655440021',
            title: 'Global older',
            content: 'global older',
            order: 2
          })
        ],
        assistantState: {
          assistants: [
            {
              id: 'assistant-1',
              regularPhrases: [
                makePhrase({
                  id: '550e8400-e29b-41d4-a716-446655440022',
                  title: 'Assistant older',
                  content: 'assistant older'
                }),
                makePhrase({
                  id: '550e8400-e29b-41d4-a716-446655440023',
                  title: 'Assistant newer',
                  content: 'assistant newer'
                })
              ]
            }
          ],
          presets: []
        }
      })
      const batches = captureInsertedRows(ctx)
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      await migrator.execute(ctx)

      expect(batches[0].map((row) => row.title)).toEqual([
        'Global older',
        'Global newer',
        'Assistant older',
        'Assistant newer'
      ])
    })

    it('should regenerate invalid ids and normalize titles before insertion', async () => {
      const ctx = createMockContext({
        assistantState: {
          assistants: [
            {
              id: 'assistant-1',
              regularPhrases: [
                makePhrase({ id: '', title: `  ${'a'.repeat(PROMPT_TITLE_MAX + 20)}  `, content: 'first' }),
                makePhrase({ id: 'not-a-uuid', title: '  Second  ', content: 'second' })
              ]
            }
          ],
          presets: []
        }
      })
      const batches = captureInsertedRows(ctx)
      const migrator = new PromptMigrator()

      await migrator.prepare(ctx)
      const executeResult = await migrator.execute(ctx)

      expect(executeResult).toMatchObject({ success: true, processedCount: 2 })
      expect(new Set(batches[0].map((row) => row.id)).size).toBe(2)
      expect(batches[0].every((row) => PromptIdSchema.safeParse(row.id).success)).toBe(true)
      expect(batches[0].map((row) => row.title)).toEqual(['a'.repeat(PROMPT_TITLE_MAX), 'Second'])
    })

    it('should truncate titles without splitting a UTF-16 surrogate pair', async () => {
      const exactTitle = `${'a'.repeat(PROMPT_TITLE_MAX - 2)}😀`
      const overLimitTitle = `${'b'.repeat(PROMPT_TITLE_MAX - 1)}😀`
      const ctx = createMockContext({
        tableData: [
          makePhrase({ id: makeUuid(70), title: exactTitle, content: 'exact boundary' }),
          makePhrase({ id: makeUuid(71), title: overLimitTitle, content: 'split boundary' })
        ]
      })
      const batches = captureInsertedRows(ctx)
      const migrator = new PromptMigrator()

      await migrator.prepare(ctx)
      await migrator.execute(ctx)

      expect(batches[0].map((row) => row.title)).toEqual([exactTitle, 'b'.repeat(PROMPT_TITLE_MAX - 1)])
    })

    it('should insert large prompt sets in bounded batches inside one transaction', async () => {
      const ctx = createMockContext({
        tableData: Array.from({ length: 101 }, (_, index) =>
          makePhrase({ id: makeUuid(index), title: `Prompt ${index}`, content: `content ${index}` })
        )
      })
      const batches = captureInsertedRows(ctx)
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.execute(ctx)

      expect(result).toMatchObject({ success: true, processedCount: 101 })
      expect(ctx.db.transaction).toHaveBeenCalledTimes(1)
      expect(batches.map((batch) => batch.length)).toEqual([100, 1])
    })

    it('should collapse identical phrases that share an id', async () => {
      const phrase = makePhrase({
        id: '550e8400-e29b-41d4-a716-446655440030',
        title: 'Shared',
        content: 'same content'
      })
      const ctx = createMockContext({
        tableData: [phrase],
        assistantState: {
          assistants: [{ id: 'assistant-1', regularPhrases: [{ ...phrase }] }],
          presets: []
        }
      })
      const batches = captureInsertedRows(ctx)
      const migrator = new PromptMigrator()

      const prepareResult = await migrator.prepare(ctx)
      const executeResult = await migrator.execute(ctx)

      expect(prepareResult.itemCount).toBe(1)
      expect(executeResult.processedCount).toBe(1)
      expect(batches[0]).toHaveLength(1)
    })

    it('should preserve conflicting phrases that share an id by assigning a new id', async () => {
      const legacyId = '550e8400-e29b-41d4-a716-446655440040'
      const assistantPhrase = makePhrase({ id: legacyId, title: 'Assistant', content: 'assistant content' })
      const ctx = createMockContext({
        tableData: [makePhrase({ id: legacyId, title: 'Global', content: 'global content' })],
        assistantState: {
          assistants: [
            {
              id: 'assistant-1',
              regularPhrases: [assistantPhrase]
            }
          ],
          presets: [],
          defaultAssistant: { id: 'default', regularPhrases: [{ ...assistantPhrase }] }
        }
      })
      const batches = captureInsertedRows(ctx)
      const migrator = new PromptMigrator()

      const prepareResult = await migrator.prepare(ctx)
      const executeResult = await migrator.execute(ctx)

      expect(prepareResult.itemCount).toBe(2)
      expect(executeResult.processedCount).toBe(2)
      expect(batches[0].map((row) => row.content)).toEqual(['global content', 'assistant content'])
      expect(batches[0][0].id).toBe(legacyId)
      expect(batches[0][1].id).not.toBe(legacyId)
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

      ;(ctx.db.transaction as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('db error')
      })

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
        values: vi.fn().mockImplementation(() => ({
          run: vi.fn().mockImplementation(() => {
            throw new Error('UNIQUE constraint failed: prompt.id')
          })
        }))
      }))

      ;(ctx.db.transaction as ReturnType<typeof vi.fn>).mockImplementation((fn: (tx: unknown) => void) => {
        fn({ insert: insertFn })
      })

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
          return { run: vi.fn() }
        })
      }))
      ;(ctx.db.transaction as ReturnType<typeof vi.fn>).mockImplementation((fn: (tx: unknown) => void) => {
        fn({ insert: insertFn })
      })

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

      ;(ctx.db.transaction as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('forced rollback')
      })
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

    it('should reject target rows that match the count but violate the prompt contract', async () => {
      const ctx = createMockContext({
        tableData: [makePhrase({ id: '550e8400-e29b-41d4-a716-446655440060', content: 'valid' })],
        promptCount: 1,
        promptRows: [
          {
            id: 'not-a-uuid',
            title: 'Prompt',
            content: 'valid',
            orderKey: 'a0',
            createdAt: 1700000000000,
            updatedAt: 1700000000000
          }
        ]
      })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.validate(ctx)

      expect(result.success).toBe(false)
      expect(result.errors).toContainEqual(expect.objectContaining({ key: 'prompt_contract_mismatch', actual: 1 }))
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

    it('should include invalid assistant phrases in source and skipped counts', async () => {
      const ctx = createMockContext({
        promptCount: 1,
        assistantState: {
          assistants: [
            {
              id: 'assistant-1',
              regularPhrases: [
                makePhrase({ id: '550e8400-e29b-41d4-a716-446655440050', content: 'valid' }),
                makePhrase({ id: '550e8400-e29b-41d4-a716-446655440051', content: '' })
              ]
            }
          ],
          presets: []
        }
      })
      const migrator = new PromptMigrator()
      await migrator.prepare(ctx)

      const result = await migrator.validate(ctx)

      expect(result.success).toBe(true)
      expect(result.stats).toMatchObject({ sourceCount: 2, targetCount: 1, skippedCount: 1 })
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
