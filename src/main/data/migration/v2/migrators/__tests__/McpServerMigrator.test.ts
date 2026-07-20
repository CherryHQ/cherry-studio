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
      const diagnosed = await migrator.prepareWithDiagnostics(ctx as any)
      expect(diagnosed.result.success).toBe(false)
      expect(diagnosed.result.itemCount).toBe(0)
      expect(diagnosed.failure).toEqual({
        classification: { errorCode: 'source_required_records_rejected' },
        evidence: {
          kind: 'all_required_rows_rejected',
          sourceRole: 'mcp_server',
          fieldRole: 'source_id',
          rejectedCountBucket: '2-10'
        }
      })
    })

    it('should filter out servers without id', async () => {
      const servers = [
        { id: 'srv-1', name: 'valid', isActive: true },
        { name: 'no-id', isActive: false },
        { id: '', name: 'empty-id', isActive: false }
      ]
      const ctx = createMockContext({ mcp: { servers } })
      const diagnosed = await migrator.prepareWithDiagnostics(ctx as any)
      expect(diagnosed).toStrictEqual({
        result: {
          success: true,
          itemCount: 1,
          warnings: ['Skipped server without valid id: no-id', 'Skipped server without valid id: empty-id']
        }
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
    it('records bounded MCP payload lengths when SQLite rejects an oversized batch', async () => {
      const canary = `PRIVATE_MCP_KEY_${'x'.repeat(300_000)}`
      const ctx = createMockContext({
        mcp: { servers: [{ id: 'oversized', name: 'server', type: 'stdio', env: { SECRET: canary } }] }
      })
      const sqliteError = Object.assign(new Error('PRIVATE_STACK_/Users/alice'), { code: 'SQLITE_TOOBIG' })
      ctx.db.transaction = vi.fn((operation: (tx: unknown) => void) =>
        operation({
          insert: () => ({
            values: () => ({
              run: () => {
                throw sqliteError
              }
            })
          })
        })
      )
      await migrator.prepare(ctx as any)

      const diagnosed = await migrator.executeWithDiagnostics(ctx as any)

      expect(diagnosed.result.success).toBe(false)
      expect(diagnosed.failure).toMatchObject({
        classification: { errorCode: 'sqlite_too_big' },
        evidence: {
          kind: 'failed_write',
          operationRole: 'insert',
          values: expect.arrayContaining([
            expect.objectContaining({ role: 'json_value', kind: 'json', byteLengthBucket: '262145+' })
          ])
        }
      })
      expect(JSON.stringify(diagnosed.failure)).not.toContain('PRIVATE_MCP_KEY')
      expect(JSON.stringify(diagnosed.failure)).not.toContain('/Users/alice')
    })

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
      const diagnosed = await migrator.executeWithDiagnostics(ctx as any)
      expect(diagnosed).toStrictEqual({ result: { success: true, processedCount: 4 } })
      expect(ctx.insertedRows.map((row) => row.name)).toEqual(ctx.insertedRows.map((row) => row.id))
      expect(ctx.insertedRows.map((row) => row.name)).not.toEqual([
        'srv-no-name',
        'srv-empty-name',
        'srv-whitespace-name',
        'srv-null-name'
      ])
    })

    it('normalizes an arbitrary legacy type to null without creating a fatal diagnostic', async () => {
      const ctx = createMockContext({
        mcp: { servers: [{ id: 'srv-arbitrary-type', name: 'legacy', type: 'PRIVATE_ARBITRARY_TYPE' }] }
      })

      const prepared = await migrator.prepareWithDiagnostics(ctx as any)
      const executed = await migrator.executeWithDiagnostics(ctx as any)

      expect(prepared).toStrictEqual({ result: { success: true, itemCount: 1, warnings: undefined } })
      expect(executed).toStrictEqual({ result: { success: true, processedCount: 1 } })
      expect(ctx.insertedRows).toEqual([expect.objectContaining({ type: null })])
      expect(JSON.stringify({ prepared, executed, insertedRows: ctx.insertedRows })).not.toContain(
        'PRIVATE_ARBITRARY_TYPE'
      )
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
