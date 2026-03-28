import fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MemoryMigrator } from '../MemoryMigrator'

// Mock fs (MemoryMigrator imports 'fs', not 'node:fs')
vi.mock('fs', () => ({
  default: { existsSync: vi.fn() },
  existsSync: vi.fn()
}))

// Mock @libsql/client
const mockExecute = vi.fn()
const mockClose = vi.fn()
vi.mock('@libsql/client', () => ({
  createClient: vi.fn(() => ({
    execute: mockExecute,
    close: mockClose
  }))
}))

// Mock @main/config
vi.mock('@main/config', () => ({
  DATA_PATH: '/mock/data'
}))

function createMockContext() {
  return {
    sources: {
      electronStore: { get: vi.fn() },
      reduxState: { getCategory: vi.fn() },
      dexieExport: { readTable: vi.fn(), createStreamReader: vi.fn(), tableExists: vi.fn() },
      dexieSettings: { keys: vi.fn().mockReturnValue([]), get: vi.fn() }
    },
    db: {
      transaction: vi.fn(async (fn: (tx: any) => Promise<void>) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              onConflictDoNothing: vi.fn().mockResolvedValue(undefined)
            })
          })
        }
        await fn(tx)
        return tx
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ count: 0 }),
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ count: 0 })
          })
        })
      })
    },
    sharedData: new Map(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  }
}

const SAMPLE_MEMORIES = [
  {
    id: 'mem-1',
    memory: 'User prefers dark mode',
    hash: 'hash-1',
    embedding: null,
    metadata: '{"source":"chat"}',
    user_id: 'user-1',
    agent_id: null,
    run_id: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    is_deleted: 0
  },
  {
    id: 'mem-2',
    memory: 'User likes TypeScript',
    hash: 'hash-2',
    embedding: null,
    metadata: null,
    user_id: 'user-1',
    agent_id: 'agent-1',
    run_id: 'run-1',
    created_at: '2024-01-02T00:00:00.000Z',
    updated_at: '2024-01-02T00:00:00.000Z',
    is_deleted: 0
  }
]

const SAMPLE_HISTORY = [
  {
    id: 1,
    memory_id: 'mem-1',
    previous_value: null,
    new_value: 'User prefers dark mode',
    action: 'ADD' as const,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    is_deleted: 0
  }
]

// Helper to set up fs.existsSync behavior
function mockDbExists(exists: boolean) {
  vi.mocked(fs.existsSync).mockReturnValue(exists)
}

// Helper to set up legacy db responses
function mockLegacyDbResponses(responses: { rows: any[] }[]) {
  let callIndex = 0
  mockExecute.mockImplementation(() => {
    const response = responses[callIndex] ?? { rows: [] }
    callIndex++
    return Promise.resolve(response)
  })
}

describe('MemoryMigrator', () => {
  let migrator: MemoryMigrator

  beforeEach(() => {
    vi.clearAllMocks()
    migrator = new MemoryMigrator()
    migrator.setProgressCallback(vi.fn())
  })

  it('should have correct metadata', () => {
    expect(migrator.id).toBe('memory')
    expect(migrator.name).toBe('Memory')
    expect(migrator.order).toBe(6)
  })

  describe('prepare', () => {
    it('should skip when legacy db not found', async () => {
      mockDbExists(false)
      const result = await migrator.prepare()
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
      expect(result.warnings).toContain('Legacy memories.db not found - skipping memory migration')
    })

    it('should count source rows when db exists', async () => {
      mockDbExists(true)
      // legacyTableExists('memories') -> count 1, legacyTableExists('memory_history') -> count 1
      // COUNT memories -> 2, COUNT memory_history -> 1
      mockLegacyDbResponses([
        { rows: [{ count: 1 }] }, // memories table exists
        { rows: [{ count: 1 }] }, // memory_history table exists
        { rows: [{ count: 2 }] }, // COUNT(*) from memories
        { rows: [{ count: 1 }] } // COUNT(*) from memory_history
      ])

      const result = await migrator.prepare()
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(3)
      expect(result.warnings).toBeUndefined()
    })

    it('should warn when memories table not found', async () => {
      mockDbExists(true)
      mockLegacyDbResponses([
        { rows: [{ count: 0 }] }, // memories table does NOT exist
        { rows: [{ count: 1 }] }, // memory_history table exists
        { rows: [{ count: 3 }] } // COUNT memory_history
      ])

      const result = await migrator.prepare()
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(3)
      expect(result.warnings).toContain('Legacy memories table not found, skipping memory rows')
    })

    it('should warn when memory_history table not found', async () => {
      mockDbExists(true)
      mockLegacyDbResponses([
        { rows: [{ count: 1 }] }, // memories table exists
        { rows: [{ count: 0 }] }, // memory_history table does NOT exist
        { rows: [{ count: 5 }] } // COUNT memories
      ])

      const result = await migrator.prepare()
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(5)
      expect(result.warnings).toContain('Legacy memory_history table not found, skipping history rows')
    })

    it('should handle legacy db read error', async () => {
      mockDbExists(true)
      mockExecute.mockRejectedValue(new Error('SQLITE_CORRUPT'))

      const result = await migrator.prepare()
      expect(result.success).toBe(false)
      expect(result.warnings).toContainEqual(expect.stringContaining('SQLITE_CORRUPT'))
    })
  })

  describe('execute', () => {
    it('should return early when no source data', async () => {
      mockDbExists(false)
      const ctx = createMockContext()
      await migrator.prepare()
      const result = await migrator.execute(ctx as any)
      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(0)
    })

    it('should insert memories and history into database', async () => {
      mockDbExists(true)
      // prepare phase responses
      mockLegacyDbResponses([
        { rows: [{ count: 1 }] }, // memories table exists
        { rows: [{ count: 1 }] }, // memory_history table exists
        { rows: [{ count: 2 }] }, // COUNT memories
        { rows: [{ count: 1 }] }, // COUNT memory_history
        // execute phase responses
        { rows: SAMPLE_MEMORIES }, // SELECT * FROM memories
        { rows: SAMPLE_HISTORY } // SELECT * FROM memory_history
      ])

      const ctx = createMockContext()
      await migrator.prepare()
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(3)
      expect(ctx.db.transaction).toHaveBeenCalled()
    })

    it('should filter out rows with missing id or memory', async () => {
      const invalidMemories = [
        { ...SAMPLE_MEMORIES[0] },
        {
          id: '',
          memory: 'no id',
          hash: 'h',
          embedding: null,
          metadata: null,
          user_id: null,
          agent_id: null,
          run_id: null,
          created_at: null,
          updated_at: null,
          is_deleted: 0
        },
        {
          id: 'mem-3',
          memory: '',
          hash: 'h2',
          embedding: null,
          metadata: null,
          user_id: null,
          agent_id: null,
          run_id: null,
          created_at: null,
          updated_at: null,
          is_deleted: 0
        }
      ]

      mockDbExists(true)
      mockLegacyDbResponses([
        { rows: [{ count: 1 }] },
        { rows: [{ count: 0 }] }, // no history table
        { rows: [{ count: 3 }] },
        { rows: invalidMemories }
      ])

      const ctx = createMockContext()
      await migrator.prepare()
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(true)
      // Only 1 valid memory, 0 history
      expect(result.processedCount).toBe(1)
    })

    it('should skip orphan history rows', async () => {
      const orphanHistory = [
        { ...SAMPLE_HISTORY[0] },
        {
          id: 2,
          memory_id: 'nonexistent',
          previous_value: null,
          new_value: 'orphan',
          action: 'ADD' as const,
          created_at: null,
          updated_at: null,
          is_deleted: 0
        }
      ]

      mockDbExists(true)
      mockLegacyDbResponses([
        { rows: [{ count: 1 }] },
        { rows: [{ count: 1 }] },
        { rows: [{ count: 2 }] },
        { rows: [{ count: 2 }] },
        { rows: SAMPLE_MEMORIES },
        { rows: orphanHistory }
      ])

      const ctx = createMockContext()
      await migrator.prepare()
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(true)
      // 2 memories + 1 valid history (orphan skipped)
      expect(result.processedCount).toBe(3)
    })

    it('should handle transaction failure', async () => {
      mockDbExists(true)
      mockLegacyDbResponses([
        { rows: [{ count: 1 }] },
        { rows: [{ count: 1 }] },
        { rows: [{ count: 2 }] },
        { rows: [{ count: 1 }] },
        { rows: SAMPLE_MEMORIES },
        { rows: SAMPLE_HISTORY }
      ])

      const ctx = createMockContext()
      ;(ctx.db as any).transaction = vi.fn().mockRejectedValue(new Error('SQLITE_FULL'))

      await migrator.prepare()
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(false)
      expect(result.error).toContain('SQLITE_FULL')
      expect(result.processedCount).toBe(0)
    })

    it('should handle deleted rows by setting deletedAt', async () => {
      const deletedMemory = [
        {
          ...SAMPLE_MEMORIES[0],
          is_deleted: 1,
          updated_at: '2024-06-01T00:00:00.000Z'
        }
      ]

      mockDbExists(true)
      mockLegacyDbResponses([
        { rows: [{ count: 1 }] },
        { rows: [{ count: 0 }] },
        { rows: [{ count: 1 }] },
        { rows: deletedMemory }
      ])

      const ctx = createMockContext()
      let insertedValues: any = null
      ;(ctx.db as any).transaction = vi.fn(async (fn: any) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals) => {
              insertedValues = vals
              return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }
            })
          })
        }
        await fn(tx)
      })

      await migrator.prepare()
      await migrator.execute(ctx as any)

      expect(insertedValues).toBeDefined()
      expect(insertedValues[0].deletedAt).toBe('2024-06-01T00:00:00.000Z')
    })
  })

  describe('validate', () => {
    function mockValidateDb(
      ctx: ReturnType<typeof createMockContext>,
      memoryCount: number,
      historyCount: number,
      orphanCount = 0
    ) {
      let selectCallIndex = 0
      ctx.db.select = vi.fn().mockImplementation(() => {
        const callIdx = selectCallIndex++
        if (callIdx < 2) {
          // First two calls: count queries for memory and memory_history
          const count = callIdx === 0 ? memoryCount : historyCount
          return {
            from: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({ count })
            })
          }
        }
        // Third call: orphan history check
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({ count: orphanCount })
            })
          })
        }
      })
    }

    it('should pass when counts match', async () => {
      mockDbExists(true)
      mockLegacyDbResponses([
        { rows: [{ count: 1 }] },
        { rows: [{ count: 1 }] },
        { rows: [{ count: 2 }] },
        { rows: [{ count: 1 }] }
      ])

      const ctx = createMockContext()
      await migrator.prepare()
      mockValidateDb(ctx, 2, 1)

      const result = await migrator.validate(ctx as any)
      expect(result.success).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.stats).toEqual({
        sourceCount: 3,
        targetCount: 3,
        skippedCount: 0,
        mismatchReason: undefined
      })
    })

    it('should fail on count mismatch', async () => {
      mockDbExists(true)
      mockLegacyDbResponses([
        { rows: [{ count: 1 }] },
        { rows: [{ count: 1 }] },
        { rows: [{ count: 5 }] },
        { rows: [{ count: 3 }] }
      ])

      const ctx = createMockContext()
      await migrator.prepare()
      mockValidateDb(ctx, 3, 1) // target=4 < source=8

      const result = await migrator.validate(ctx as any)
      expect(result.success).toBe(false)
      expect(result.errors).toContainEqual(expect.objectContaining({ key: 'memory_count_mismatch' }))
    })

    it('should fail when orphan history rows found', async () => {
      mockDbExists(true)
      mockLegacyDbResponses([
        { rows: [{ count: 1 }] },
        { rows: [{ count: 1 }] },
        { rows: [{ count: 2 }] },
        { rows: [{ count: 1 }] }
      ])

      const ctx = createMockContext()
      await migrator.prepare()
      mockValidateDb(ctx, 2, 1, 3) // 3 orphans

      const result = await migrator.validate(ctx as any)
      expect(result.success).toBe(false)
      expect(result.errors).toContainEqual(expect.objectContaining({ key: 'memory_orphan_history' }))
    })

    it('should pass with zero items', async () => {
      mockDbExists(false)
      const ctx = createMockContext()
      await migrator.prepare()
      mockValidateDb(ctx, 0, 0)

      const result = await migrator.validate(ctx as any)
      expect(result.success).toBe(true)
      expect(result.stats.sourceCount).toBe(0)
      expect(result.stats.targetCount).toBe(0)
    })

    it('should return failure when db throws', async () => {
      mockDbExists(false)
      const ctx = createMockContext()
      await migrator.prepare()
      ctx.db.select = vi.fn().mockImplementation(() => {
        throw new Error('DB_CORRUPT')
      })

      const result = await migrator.validate(ctx as any)
      expect(result.success).toBe(false)
      expect(result.errors[0].message).toContain('DB_CORRUPT')
    })
  })

  describe('data mapping', () => {
    it('should parse metadata JSON correctly', async () => {
      mockDbExists(true)
      mockLegacyDbResponses([
        { rows: [{ count: 1 }] },
        { rows: [{ count: 0 }] },
        { rows: [{ count: 1 }] },
        { rows: [{ ...SAMPLE_MEMORIES[0], metadata: '{"key":"value"}' }] }
      ])

      const ctx = createMockContext()
      let insertedValues: any = null
      ;(ctx.db as any).transaction = vi.fn(async (fn: any) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals) => {
              insertedValues = vals
              return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }
            })
          })
        }
        await fn(tx)
      })

      await migrator.prepare()
      await migrator.execute(ctx as any)

      expect(insertedValues[0].metadata).toEqual({ key: 'value' })
    })

    it('should handle invalid metadata JSON gracefully', async () => {
      mockDbExists(true)
      mockLegacyDbResponses([
        { rows: [{ count: 1 }] },
        { rows: [{ count: 0 }] },
        { rows: [{ count: 1 }] },
        { rows: [{ ...SAMPLE_MEMORIES[0], metadata: 'not-json' }] }
      ])

      const ctx = createMockContext()
      let insertedValues: any = null
      ;(ctx.db as any).transaction = vi.fn(async (fn: any) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals) => {
              insertedValues = vals
              return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }
            })
          })
        }
        await fn(tx)
      })

      await migrator.prepare()
      await migrator.execute(ctx as any)

      expect(insertedValues[0].metadata).toBeNull()
    })

    it('should use id as hash fallback when hash is null', async () => {
      mockDbExists(true)
      mockLegacyDbResponses([
        { rows: [{ count: 1 }] },
        { rows: [{ count: 0 }] },
        { rows: [{ count: 1 }] },
        { rows: [{ ...SAMPLE_MEMORIES[0], hash: null }] }
      ])

      const ctx = createMockContext()
      let insertedValues: any = null
      ;(ctx.db as any).transaction = vi.fn(async (fn: any) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals) => {
              insertedValues = vals
              return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }
            })
          })
        }
        await fn(tx)
      })

      await migrator.prepare()
      await migrator.execute(ctx as any)

      expect(insertedValues[0].hash).toBe('mem-1')
    })

    it('should use fallback timestamps when created_at is null', async () => {
      mockDbExists(true)
      mockLegacyDbResponses([
        { rows: [{ count: 1 }] },
        { rows: [{ count: 0 }] },
        { rows: [{ count: 1 }] },
        { rows: [{ ...SAMPLE_MEMORIES[0], created_at: null, updated_at: null }] }
      ])

      const ctx = createMockContext()
      let insertedValues: any = null
      ;(ctx.db as any).transaction = vi.fn(async (fn: any) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((vals) => {
              insertedValues = vals
              return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }
            })
          })
        }
        await fn(tx)
      })

      await migrator.prepare()
      await migrator.execute(ctx as any)

      expect(insertedValues[0].createdAt).toBeTruthy()
      expect(insertedValues[0].updatedAt).toBeTruthy()
    })
  })
})
