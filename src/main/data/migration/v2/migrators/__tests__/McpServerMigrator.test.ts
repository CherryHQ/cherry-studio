import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReduxStateReader } from '../../utils/ReduxStateReader'
import { McpServerMigrator } from '../McpServerMigrator'

function createMockContext(reduxData: Record<string, unknown> = {}) {
  const reduxState = new ReduxStateReader(reduxData)

  return {
    sources: {
      electronStore: { get: vi.fn() },
      reduxState,
      dexieExport: { readTable: vi.fn(), createStreamReader: vi.fn(), tableExists: vi.fn() }
    },
    db: {
      transaction: vi.fn(async (fn: (tx: any) => Promise<void>) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined)
          })
        }
        await fn(tx)
        return tx
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ count: 0 })
        })
      })
    },
    sharedData: new Map(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }
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
    expect(migrator.order).toBeGreaterThanOrEqual(2)
  })

  describe('prepare', () => {
    it('should count source servers', async () => {
      const ctx = createMockContext({ mcp: { servers: SAMPLE_SERVERS } })
      const result = await migrator.prepare(ctx as any)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(3)
    })

    it('should handle empty servers array', async () => {
      const ctx = createMockContext({ mcp: { servers: [] } })
      const result = await migrator.prepare(ctx as any)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('should handle missing mcp category', async () => {
      const ctx = createMockContext({})
      const result = await migrator.prepare(ctx as any)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
    })

    it('should handle missing servers key', async () => {
      const ctx = createMockContext({ mcp: {} })
      const result = await migrator.prepare(ctx as any)

      expect(result.success).toBe(true)
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

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(1)
    })

    it('should deduplicate servers by id', async () => {
      const servers = [
        { id: 'dup-1', name: 'first', isActive: true },
        { id: 'dup-1', name: 'duplicate', isActive: false },
        { id: 'srv-2', name: 'unique', isActive: true }
      ]
      const ctx = createMockContext({ mcp: { servers } })
      const result = await migrator.prepare(ctx as any)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(2)
    })
  })

  describe('execute', () => {
    it('should insert servers into database', async () => {
      const ctx = createMockContext({ mcp: { servers: SAMPLE_SERVERS } })
      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(3)
      expect(ctx.db.transaction).toHaveBeenCalled()
    })

    it('should handle empty servers gracefully', async () => {
      const ctx = createMockContext({ mcp: { servers: [] } })
      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(0)
    })
  })

  describe('validate', () => {
    it('should pass when counts match', async () => {
      const ctx = createMockContext({ mcp: { servers: SAMPLE_SERVERS } })

      // Mock DB count to return 3
      ctx.db.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ count: 3 })
        })
      })

      await migrator.prepare(ctx as any)
      const result = await migrator.validate(ctx as any)

      expect(result.success).toBe(true)
      expect(result.stats.sourceCount).toBe(3)
      expect(result.stats.targetCount).toBe(3)
      expect(result.stats.skippedCount).toBe(0)
    })

    it('should pass with zero items', async () => {
      const ctx = createMockContext({})

      ctx.db.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ count: 0 })
        })
      })

      await migrator.prepare(ctx as any)
      const result = await migrator.validate(ctx as any)

      expect(result.success).toBe(true)
      expect(result.stats.sourceCount).toBe(0)
      expect(result.stats.targetCount).toBe(0)
    })
  })
})
