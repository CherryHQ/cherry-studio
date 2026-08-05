import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createClientMock, state } = vi.hoisted(() => {
  type MemoryRow = {
    id: string
    memory: string
    hash: string
    metadata: string | null
    user_id: string | null
    agent_id: string | null
    run_id: string | null
    created_at: string
    updated_at: string
    is_deleted: number
  }

  const state = {
    rows: [] as MemoryRow[]
  }

  const execute = vi.fn(async (query: string | { sql: string; args?: any[] }) => {
    const sql = typeof query === 'string' ? query : query.sql
    const args = typeof query === 'string' ? [] : query.args || []

    if (sql.includes('SELECT id, hash, user_id, agent_id, is_deleted FROM memories')) {
      const hashCandidates = args.slice(0, 3)
      const userId = args[4] ?? null
      const agentId = args[7] ?? null
      const preferredHash = args[8]
      const preferredUserScopedHash = args[9]

      const rows = state.rows
        .filter((row) => {
          const userMatches = userId === null ? row.user_id === null : row.user_id === userId
          const agentMatches =
            agentId === null ? row.agent_id === null : row.agent_id === agentId || row.agent_id === null

          return hashCandidates.includes(row.hash) && userMatches && agentMatches
        })
        .sort((left, right) => {
          const hashRank = (row: MemoryRow) => {
            if (row.hash === preferredHash) return 0
            if (row.hash === preferredUserScopedHash) return 1
            return 2
          }
          const agentRank = (row: MemoryRow) => {
            if (row.agent_id === agentId) return 0
            if (row.agent_id === null) return 1
            return 2
          }

          return hashRank(left) - hashRank(right) || agentRank(left) - agentRank(right)
        })

      return { rows: rows.slice(0, 1) }
    }

    if (sql.includes('INSERT INTO memories')) {
      const [id, memory, hash, , metadata, userId, agentId, runId, createdAt, updatedAt] = args

      if (state.rows.some((row) => row.hash === hash)) {
        throw new Error('UNIQUE constraint failed: memories.hash')
      }

      state.rows.push({
        id,
        memory,
        hash,
        metadata,
        user_id: userId,
        agent_id: agentId,
        run_id: runId,
        created_at: createdAt,
        updated_at: updatedAt,
        is_deleted: 0
      })

      return { rows: [] }
    }

    if (sql.includes('UPDATE memories') && sql.includes('SET is_deleted = 0')) {
      const [memory, , metadata, updatedAt, id] = args
      const row = state.rows.find((row) => row.id === id)

      if (row) {
        row.is_deleted = 0
        row.memory = memory
        row.metadata = metadata
        row.updated_at = updatedAt
      }

      return { rows: [] }
    }

    return { rows: [] }
  })

  return {
    createClientMock: vi.fn(() => ({
      execute,
      close: vi.fn()
    })),
    state
  }
})

vi.mock('@libsql/client', () => ({
  createClient: createClientMock
}))

describe('MemoryService', () => {
  beforeEach(() => {
    state.rows = []
    createClientMock.mockClear()
  })

  it('allows identical memory text in different user scopes', async () => {
    const { default: MemoryService } = await import('../MemoryService')
    const service = MemoryService.reload()

    const first = await service.add('Meeting PIN is 1234', {
      userId: 'user_alice',
      agentId: 'agent_sales'
    })
    const second = await service.add('Meeting PIN is 1234', {
      userId: 'user_bob',
      agentId: 'agent_support'
    })

    expect(first.count).toBe(1)
    expect(second.count).toBe(1)
    expect(state.rows).toHaveLength(2)
    expect(new Set(state.rows.map((row) => row.hash))).toHaveLength(2)
  })

  it('allows identical memory text in different assistant scopes for the same user', async () => {
    const { default: MemoryService } = await import('../MemoryService')
    const service = MemoryService.reload()

    const first = await service.add('Project code name is Orion', {
      userId: 'user_alice',
      agentId: 'agent_sales'
    })
    const second = await service.add('Project code name is Orion', {
      userId: 'user_alice',
      agentId: 'agent_support'
    })

    expect(first.count).toBe(1)
    expect(second.count).toBe(1)
    expect(state.rows).toHaveLength(2)
    expect(new Set(state.rows.map((row) => row.hash))).toHaveLength(2)
  })

  it('still deduplicates identical memory text in the same user and assistant scope', async () => {
    const { default: MemoryService } = await import('../MemoryService')
    const service = MemoryService.reload()

    const first = await service.add('Customer prefers email updates', {
      userId: 'user_alice',
      agentId: 'agent_sales'
    })
    const second = await service.add('Customer prefers email updates', {
      userId: 'user_alice',
      agentId: 'agent_sales'
    })

    expect(first.count).toBe(1)
    expect(second.count).toBe(0)
    expect(state.rows).toHaveLength(1)
  })
})
