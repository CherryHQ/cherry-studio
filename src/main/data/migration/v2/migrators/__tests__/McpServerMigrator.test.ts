import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReduxStateReader } from '../../utils/ReduxStateReader'
import { McpServerMigrator } from '../McpServerMigrator'

function createMockContext(reduxData: Record<string, unknown> = {}) {
  const reduxState = new ReduxStateReader(reduxData)
  const insertedRows: Array<Record<string, unknown>> = []

  return {
    sources: {
      electronStore: { get: vi.fn() },
      reduxState,
      dexieExport: { readTable: vi.fn(), createStreamReader: vi.fn(), tableExists: vi.fn() },
      dexieSettings: { keys: vi.fn().mockReturnValue([]), get: vi.fn() }
    },
    db: {
      transaction: vi.fn((fn: (tx: any) => void) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn((rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
              insertedRows.push(...(Array.isArray(rows) ? rows : [rows]))
              return { run: vi.fn() }
            })
          })
        }
        return fn(tx)
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ count: 0 })
        })
      })
    },
    sharedData: new Map(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    },
    insertedRows
  }
}

const SAMPLE_SERVERS = [
  {
    id: 'srv-1',
    name: '@cherry/fetch',
    type: 'inMemory',
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: 'srv-2',
    name: 'custom-server',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'my-mcp-server'],
    env: { API_KEY: 'test' },
    isActive: false,
    installSource: 'manual'
  },
  {
    id: 'srv-3',
    name: 'sse-server',
    type: 'sse',
    baseUrl: 'http://localhost:8080',
    isActive: true,
    installSource: 'protocol'
  }
]

describe('McpServerMigrator', () => {
  let migrator: McpServerMigrator

  beforeEach(() => {
    migrator = new McpServerMigrator()
    migrator.setProgressCallback(vi.fn())
  })

  it('should have correct metadata', () => {
    expect(migrator.id).toBe('mcp_server')
    expect(migrator.name).toBe('MCP Server')
    expect(migrator.order).toBe(1.5)
  })

  describe('prepare', () => {
    it('should count source servers', async () => {
      const ctx = createMockContext({ mcp: { servers: SAMPLE_SERVERS } })
      const result = await migrator.prepare(ctx as any)
      expect(result).toStrictEqual({ success: true, itemCount: 3, warnings: undefined })
    })

    it('should handle empty servers array', async () => {
      const ctx = createMockContext({ mcp: { servers: [] } })
      const result = await migrator.prepare(ctx as any)
      expect(result).toStrictEqual({ success: true, itemCount: 0, warnings: undefined })
    })

    it('should handle missing mcp category', async () => {
      const ctx = createMockContext({})
      const result = await migrator.prepare(ctx as any)
      expect(result).toStrictEqual({ success: true, itemCount: 0, warnings: undefined })
    })

    it('should handle missing servers key', async () => {
      const ctx = createMockContext({ mcp: {} })
      const result = await migrator.prepare(ctx as any)
      expect(result).toStrictEqual({ success: true, itemCount: 0, warnings: undefined })
    })

    it('should handle non-array servers value', async () => {
      const ctx = createMockContext({ mcp: { servers: 'not-an-array' } })
      const result = await migrator.prepare(ctx as any)
      expect(result).toStrictEqual({
        success: true,
        itemCount: 0,
        warnings: ['mcp.servers is not an array']
      })
    })

    it('should fail when all servers are skipped', async () => {
      const servers = [
        { name: 'no-id-1', isActive: true },
        { name: 'no-id-2', isActive: false }
      ]
      const ctx = createMockContext({ mcp: { servers } })
      const result = await migrator.prepare(ctx as any)
      expect(result.success).toBe(false)
      expect(result.itemCount).toBe(0)
    })

    it('should filter out servers without id', async () => {
      const servers = [
        { id: 'srv-1', name: 'valid', isActive: true },
        { name: 'no-id', isActive: false },
        { id: '', name: 'empty-id', isActive: false }
      ]
      const ctx = createMockContext({ mcp: { servers } })
      const result = await migrator.prepare(ctx as any)
      expect(result).toStrictEqual({
        success: true,
        itemCount: 1,
        warnings: ['Skipped server without valid id: no-id', 'Skipped server without valid id: empty-id']
      })
    })

    it('should deduplicate servers by id', async () => {
      const servers = [
        { id: 'dup-1', name: 'first', isActive: true },
        { id: 'dup-1', name: 'duplicate', isActive: false },
        { id: 'srv-2', name: 'unique', isActive: true }
      ]
      const ctx = createMockContext({ mcp: { servers } })
      const result = await migrator.prepare(ctx as any)
      expect(result).toStrictEqual({
        success: true,
        itemCount: 2,
        warnings: ['Skipped duplicate server id: dup-1']
      })
    })
  })

  describe('execute', () => {
    it('should insert servers into database', async () => {
      const ctx = createMockContext({ mcp: { servers: SAMPLE_SERVERS } })
      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)
      expect(result).toStrictEqual({ success: true, processedCount: 3 })
      expect(ctx.db.transaction).toHaveBeenCalled()
    })

    it('uses the generated id as the name when a server has no valid name', async () => {
      const ctx = createMockContext({
        mcp: {
          servers: [
            { id: 'srv-no-name', type: 'stdio' },
            { id: 'srv-empty-name', name: '', type: 'sse' },
            { id: 'srv-whitespace-name', name: '   ', type: 'stdio' },
            { id: 'srv-null-name', name: null, type: 'streamableHttp' }
          ]
        }
      })
      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)
      expect(result).toStrictEqual({ success: true, processedCount: 4 })
      expect(ctx.insertedRows.map((row) => row.name)).toEqual(ctx.insertedRows.map((row) => row.id))
      expect(ctx.insertedRows.map((row) => row.name)).not.toEqual([
        'srv-no-name',
        'srv-empty-name',
        'srv-whitespace-name',
        'srv-null-name'
      ])
    })

    it('should handle empty servers gracefully', async () => {
      const ctx = createMockContext({ mcp: { servers: [] } })
      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)
      expect(result).toStrictEqual({ success: true, processedCount: 0 })
    })

    it('should publish an empty id mapping when there are no servers', async () => {
      // AssistantMigrator throws if mcpServerIdMapping is absent while assistants
      // still reference (now-deleted) servers. Publishing an empty map lets it
      // drop those dangling refs instead of failing the whole migration.
      const ctx = createMockContext({ mcp: { servers: [] } })
      await migrator.prepare(ctx as any)
      await migrator.execute(ctx as any)
      const mapping = ctx.sharedData.get('mcpServerIdMapping')
      expect(mapping).toBeInstanceOf(Map)
      expect((mapping as Map<string, string>).size).toBe(0)
    })

    it('coerces legacy values of the wrong shape so a scalar column never receives an object or array', async () => {
      // better-sqlite3 binds an array as positional parameters and an object as
      // named parameters, which aborts the whole batched INSERT with
      // "Too few parameter values were provided" (#20301).
      const ctx = createMockContext({
        mcp: {
          servers: [
            {
              id: 'srv-odd',
              name: 'Odd',
              provider: { name: 'legacy-object' },
              description: ['a', 'b'],
              logoUrl: { light: 'l.png', dark: 'd.png' },
              timeout: '30',
              trustedAt: new Date(5),
              longRunning: 'true',
              isActive: 'false',
              installSource: 'marketplace',
              args: ['-y', 'x'],
              env: { KEY: 'v' }
            }
          ]
        }
      })
      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)
      expect(result).toStrictEqual({ success: true, processedCount: 1 })
      const row = ctx.insertedRows[0]
      expect(row).toMatchObject({
        provider: null,
        description: null,
        logoUrl: null,
        timeout: 30,
        trustedAt: 5,
        longRunning: true,
        isActive: false,
        installSource: null,
        args: ['-y', 'x'],
        env: { KEY: 'v' }
      })
    })

    it('drops an integer a column cannot give back rather than persisting an unreadable row', async () => {
      // An `integer()` column accepts more than it can return: a non-integral
      // double is stored as REAL under integer affinity, and an integer at or
      // beyond 2^53 comes back out of the driver as a RangeError. Such a row
      // inserts fine and then breaks every read, which is #20301 again, one
      // step later. Ordinary values, including fractional ones, are kept.
      const ctx = createMockContext({
        mcp: {
          servers: [
            {
              id: 'srv-range',
              name: 'Range',
              timeout: Number.MAX_SAFE_INTEGER + 2,
              trustedAt: 1e300,
              installedAt: new Date(8.64e15 + 1)
            },
            {
              id: 'srv-ok',
              name: 'Ok',
              timeout: 30.9,
              trustedAt: '1700000000000',
              installedAt: Number.MAX_SAFE_INTEGER
            }
          ]
        }
      })
      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)

      expect(result).toStrictEqual({ success: true, processedCount: 2 })
      // Out of range, so the column is left empty rather than made unreadable.
      expect(ctx.insertedRows[0]).toMatchObject({
        name: 'Range',
        timeout: null,
        trustedAt: null,
        installedAt: null
      })
      // In range: truncated, parsed and passed through as before.
      expect(ctx.insertedRows[1]).toMatchObject({
        name: 'Ok',
        timeout: 30,
        trustedAt: 1700000000000,
        installedAt: Number.MAX_SAFE_INTEGER
      })
    })

    it('skips a row that cannot be inserted instead of failing the whole migration', async () => {
      const ctx = createMockContext({
        mcp: {
          servers: [
            { id: 'srv-1', name: 'One', type: 'stdio' },
            { id: 'srv-bad', name: 'Bad', type: 'stdio' },
            { id: 'srv-3', name: 'Three', type: 'stdio' }
          ]
        }
      })
      ctx.insertedRows.length = 0
      ctx.db.transaction = vi.fn((fn: (tx: any) => void) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn((rows: Record<string, unknown> | Array<Record<string, unknown>>) => ({
              run: vi.fn(() => {
                const list = Array.isArray(rows) ? rows : [rows]
                if (list.some((row) => row.name === 'Bad')) {
                  throw new RangeError('Too few parameter values were provided')
                }
                ctx.insertedRows.push(...list)
              })
            }))
          })
        }
        return fn(tx)
      })

      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(2)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings?.[0]).toContain('Bad')
      expect(result.warnings?.[0]).toContain('Too few parameter values')
      expect(ctx.insertedRows.map((row) => row.name)).toEqual(['One', 'Three'])
      const mapping = ctx.sharedData.get('mcpServerIdMapping') as Map<string, string>
      expect([...mapping.keys()]).toEqual(['srv-1', 'srv-3'])

      // Validation expects the rows that were actually inserted, and reports the skip.
      ctx.db.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ count: 2 }),
          limit: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) })
        })
      })
      const validation = await migrator.validate(ctx as any)
      expect(validation.success).toBe(true)
      expect(validation.stats).toMatchObject({ sourceCount: 3, targetCount: 2, skippedCount: 1 })
    })

    it('fails the migration when no row of a batch can be inserted, instead of skipping them all', async () => {
      const ctx = createMockContext({
        mcp: {
          servers: [
            { id: 'srv-1', name: 'One', type: 'stdio' },
            { id: 'srv-2', name: 'Two', type: 'stdio' }
          ]
        }
      })
      ctx.insertedRows.length = 0
      ctx.db.transaction = vi.fn((fn: (tx: any) => void) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn(() => ({
              run: vi.fn(() => {
                throw new Error('SQLITE_BUSY: database is locked')
              })
            }))
          })
        }
        return fn(tx)
      })

      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(false)
      expect(result.error).toContain('no row could be recovered')
      expect(result.error).toContain('database is locked')
      expect(result.processedCount).toBe(0)
      expect(ctx.insertedRows).toHaveLength(0)
      expect(ctx.sharedData.has('mcpServerIdMapping')).toBe(false)
    })

    it('should return failure when transaction throws', async () => {
      const ctx = createMockContext({ mcp: { servers: SAMPLE_SERVERS } })
      ctx.db.transaction = vi.fn().mockImplementation(() => {
        throw new Error('SQLITE_CONSTRAINT')
      })
      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)
      expect(result.success).toBe(false)
      expect(result.error).toContain('SQLITE_CONSTRAINT')
      expect(result.processedCount).toBe(0)
    })
  })

  describe('validate', () => {
    function mockValidateDb(ctx: ReturnType<typeof createMockContext>, count: number, sample: any[] = []) {
      ctx.db.select = vi.fn().mockImplementation((arg) => {
        if (arg) {
          // count query: select({ count: ... }).from().get()
          return {
            from: vi.fn().mockReturnValue({
              get: vi.fn().mockReturnValue({ count })
            })
          }
        }
        // sample query: select().from().limit().all()
        return {
          from: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              all: vi.fn().mockReturnValue(sample)
            })
          })
        }
      })
    }

    it('should pass when counts match and sample is valid', async () => {
      const ctx = createMockContext({ mcp: { servers: SAMPLE_SERVERS } })
      const sampleRows = SAMPLE_SERVERS.map((s) => ({ id: s.id, name: s.name }))
      mockValidateDb(ctx, 3, sampleRows)

      await migrator.prepare(ctx as any)
      const result = await migrator.validate(ctx as any)
      expect(result).toStrictEqual({
        success: true,
        errors: [],
        stats: { sourceCount: 3, targetCount: 3, skippedCount: 0 }
      })
    })

    it('should fail when sample has missing required fields', async () => {
      const ctx = createMockContext({ mcp: { servers: SAMPLE_SERVERS } })
      mockValidateDb(ctx, 3, [
        { id: '', name: 'test' },
        { id: 'srv-2', name: '' }
      ])

      await migrator.prepare(ctx as any)
      const result = await migrator.validate(ctx as any)
      expect(result.success).toBe(false)
      expect(result.errors).toHaveLength(2)
    })

    it('should pass with zero items', async () => {
      const ctx = createMockContext({})
      mockValidateDb(ctx, 0, [])

      await migrator.prepare(ctx as any)
      const result = await migrator.validate(ctx as any)
      expect(result).toStrictEqual({
        success: true,
        errors: [],
        stats: { sourceCount: 0, targetCount: 0, skippedCount: 0 }
      })
    })

    it('should fail on count mismatch', async () => {
      const ctx = createMockContext({ mcp: { servers: SAMPLE_SERVERS } })
      mockValidateDb(ctx, 2, [
        { id: 'srv-1', name: 'test1' },
        { id: 'srv-2', name: 'test2' }
      ])

      await migrator.prepare(ctx as any)
      const result = await migrator.validate(ctx as any)
      expect(result.success).toBe(false)
      expect(result.errors).toContainEqual(expect.objectContaining({ key: 'count_mismatch' }))
    })

    it('should return failure when db throws', async () => {
      const ctx = createMockContext({ mcp: { servers: SAMPLE_SERVERS } })
      ctx.db.select = vi.fn().mockImplementation(() => {
        throw new Error('DB_CORRUPT')
      })

      await migrator.prepare(ctx as any)
      const result = await migrator.validate(ctx as any)
      expect(result.success).toBe(false)
      expect(result.errors[0].message).toContain('DB_CORRUPT')
    })
  })
})
