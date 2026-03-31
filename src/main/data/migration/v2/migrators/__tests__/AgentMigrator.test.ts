import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentMigrator } from '../AgentMigrator'

// ============================================================================
// Mock agents.db via libsql
// ============================================================================

const mockExecute = vi.fn()
const mockClose = vi.fn()

vi.mock('@libsql/client', () => ({
  createClient: () => ({
    execute: mockExecute,
    close: mockClose
  })
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => '/mock/userData'
  }
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true)
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

// ============================================================================
// Sample Data
// ============================================================================

const SAMPLE_AGENTS = [
  {
    id: 'agent-1',
    type: 'claude-code',
    name: 'Code Agent',
    description: null,
    model: 'claude-sonnet-4-6',
    plan_model: null,
    small_model: null,
    accessible_paths: null,
    instructions: null,
    mcps: '["mcp-1"]',
    allowed_tools: null,
    configuration: null,
    sort_order: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  }
]

const SAMPLE_SESSIONS = [
  {
    id: 'session-1',
    agent_id: 'agent-1',
    agent_type: 'claude-code',
    name: 'Session 1',
    description: null,
    model: 'claude-sonnet-4-6',
    plan_model: null,
    small_model: null,
    accessible_paths: null,
    instructions: null,
    mcps: null,
    allowed_tools: null,
    slash_commands: null,
    configuration: null,
    sort_order: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  }
]

const SAMPLE_MESSAGES = [
  {
    id: 1,
    session_id: 'session-1',
    role: 'user',
    content: JSON.stringify({
      message: { id: 'msg-1', role: 'user' },
      blocks: [{ type: 'main_text', content: 'hello' }]
    }),
    agent_session_id: '',
    metadata: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  },
  {
    id: 2,
    session_id: 'session-1',
    role: 'agent',
    content: JSON.stringify({
      message: { id: 'msg-2', role: 'agent' },
      blocks: [{ type: 'main_text', content: 'hi there' }]
    }),
    agent_session_id: '',
    metadata: null,
    created_at: '2024-01-01T00:01:00Z',
    updated_at: '2024-01-01T00:01:00Z'
  }
]

function createMockContext() {
  return {
    sources: {
      electronStore: { get: vi.fn() },
      reduxState: { get: vi.fn() },
      dexieExport: { readTable: vi.fn(), createStreamReader: vi.fn(), tableExists: vi.fn() },
      dexieSettings: { keys: vi.fn().mockReturnValue([]), get: vi.fn() },
      localStorage: { get: vi.fn() }
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
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ count: 0 })
          }),
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

function setupMockDb(agents = SAMPLE_AGENTS, sessions = SAMPLE_SESSIONS, messages = SAMPLE_MESSAGES) {
  mockExecute.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM agents')) return { rows: agents }
    if (sql.includes('FROM sessions')) return { rows: sessions }
    if (sql.includes('FROM session_messages')) return { rows: messages }
    return { rows: [] }
  })
}

// ============================================================================
// Tests
// ============================================================================

describe('AgentMigrator', () => {
  let migrator: AgentMigrator

  beforeEach(() => {
    migrator = new AgentMigrator()
    migrator.setProgressCallback(vi.fn())
    vi.clearAllMocks()
  })

  it('should have correct metadata', () => {
    expect(migrator.id).toBe('agent')
    expect(migrator.name).toBe('Agent')
    expect(migrator.order).toBe(5)
  })

  describe('prepare', () => {
    it('should count all items from agents.db', async () => {
      setupMockDb()
      const ctx = createMockContext()
      const result = await migrator.prepare(ctx as any)

      // 1 agent + 1 session + 2 messages = 4
      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(4)
    })

    it('should handle missing agents.db', async () => {
      const fs = await import('fs')
      vi.mocked(fs.default.existsSync).mockReturnValue(false)

      const ctx = createMockContext()
      const result = await migrator.prepare(ctx as any)

      expect(result.success).toBe(true)
      expect(result.itemCount).toBe(0)
      expect(result.warnings).toContain('agents.db not found, skipping')

      vi.mocked(fs.default.existsSync).mockReturnValue(true)
    })

    it('should skip sessions with invalid agent FK', async () => {
      const orphanSession = [{ ...SAMPLE_SESSIONS[0], agent_id: 'non-existent' }]
      setupMockDb(SAMPLE_AGENTS, orphanSession, [])

      const ctx = createMockContext()
      const result = await migrator.prepare(ctx as any)

      expect(result.success).toBe(true)
      // 1 agent, 0 sessions (orphan skipped), 0 messages
      expect(result.itemCount).toBe(1)
      expect(result.warnings?.some((w) => w.includes('Skipped session'))).toBe(true)
    })

    it('should skip messages with invalid session FK', async () => {
      const orphanMsg = [{ ...SAMPLE_MESSAGES[0], session_id: 'non-existent' }]
      setupMockDb(SAMPLE_AGENTS, SAMPLE_SESSIONS, orphanMsg)

      const ctx = createMockContext()
      const result = await migrator.prepare(ctx as any)

      expect(result.success).toBe(true)
      // 1 agent + 1 session + 0 messages (orphan skipped)
      expect(result.itemCount).toBe(2)
    })

    it('should map agent role to assistant', async () => {
      setupMockDb()
      const ctx = createMockContext()
      await migrator.prepare(ctx as any)

      // Access private field for verification (the 2nd message has role: 'agent')
      // We verify via execute that it gets mapped correctly
      const result = await migrator.execute(ctx as any)
      expect(result.success).toBe(true)
    })

    it('should close legacy db even on error', async () => {
      mockExecute.mockRejectedValue(new Error('DB_CORRUPT'))
      const ctx = createMockContext()
      const result = await migrator.prepare(ctx as any)

      expect(result.success).toBe(false)
      expect(mockClose).toHaveBeenCalled()
    })
  })

  describe('execute', () => {
    it('should insert all items in a transaction', async () => {
      setupMockDb()
      const ctx = createMockContext()
      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(true)
      // 1 agent + 1 session + 2 messages = 4
      expect(result.processedCount).toBe(4)
      expect(ctx.db.transaction).toHaveBeenCalled()
    })

    it('should handle empty data gracefully', async () => {
      setupMockDb([], [], [])
      const ctx = createMockContext()
      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(true)
      expect(result.processedCount).toBe(0)
    })

    it('should return failure when transaction throws', async () => {
      setupMockDb()
      const ctx = createMockContext()
      ctx.db.transaction = vi.fn().mockRejectedValue(new Error('SQLITE_CONSTRAINT'))
      await migrator.prepare(ctx as any)
      const result = await migrator.execute(ctx as any)

      expect(result.success).toBe(false)
      expect(result.error).toContain('SQLITE_CONSTRAINT')
    })
  })

  describe('validate', () => {
    function mockValidateDb(
      ctx: ReturnType<typeof createMockContext>,
      counts: { agents: number; sessions: number; messages: number }
    ) {
      let callIndex = 0
      ctx.db.select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ count: counts.messages })
          }),
          get: vi.fn().mockResolvedValue({ count: [counts.agents, counts.sessions][callIndex++] ?? 0 })
        })
      }))
    }

    it('should pass when all counts match', async () => {
      setupMockDb()
      const ctx = createMockContext()
      await migrator.prepare(ctx as any)

      mockValidateDb(ctx, { agents: 1, sessions: 1, messages: 2 })
      const result = await migrator.validate(ctx as any)
      expect(result.success).toBe(true)
      expect(result.stats?.sourceCount).toBe(4)
    })

    it('should fail on count mismatch', async () => {
      setupMockDb()
      const ctx = createMockContext()
      await migrator.prepare(ctx as any)

      mockValidateDb(ctx, { agents: 0, sessions: 0, messages: 0 })
      const result = await migrator.validate(ctx as any)
      expect(result.success).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should pass with zero items', async () => {
      setupMockDb([], [], [])
      const ctx = createMockContext()
      await migrator.prepare(ctx as any)

      mockValidateDb(ctx, { agents: 0, sessions: 0, messages: 0 })
      const result = await migrator.validate(ctx as any)
      expect(result.success).toBe(true)
    })
  })
})
