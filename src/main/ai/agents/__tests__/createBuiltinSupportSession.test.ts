import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadInput: vi.fn()
}))

vi.mock('../ensureBuiltinAgent', () => ({
  loadBuiltinAgentEnsureInput: mocks.loadInput
}))

import { createBuiltinSupportSession } from '../createBuiltinSupportSession'

describe('createBuiltinSupportSession', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadInput.mockReturnValue({
      builtinRole: 'support',
      configuration: {
        avatar: '🧰',
        permission_mode: 'default',
        max_turns: 100,
        env_vars: {}
      },
      name: 'Cherry Support',
      preferredModelId: null,
      type: 'claude-code'
    })
  })

  it('atomically restores Cherry Support and creates a fresh system session', () => {
    const session = createBuiltinSupportSession()

    expect(session).toMatchObject({
      agentId: expect.any(String),
      name: '',
      workspace: { type: 'system' }
    })
    expect(dbh.db.select().from(agentTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(1)
  })

  it('reuses the active Cherry Support role but creates a new session for every request', () => {
    const first = createBuiltinSupportSession()
    const second = createBuiltinSupportSession()

    expect(first.id).not.toBe(second.id)
    expect(first.agentId).toBe(second.agentId)
    expect(dbh.db.select().from(agentTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(2)
  })

  it('rolls back the restored Support role when session creation fails', () => {
    const originalCreateTx = agentSessionService.createTx.bind(agentSessionService)
    vi.spyOn(agentSessionService, 'createTx').mockImplementationOnce((tx, id, dto) => {
      originalCreateTx(tx, id, dto)
      throw new Error('forced session creation failure')
    })
    const onAgentCreated = vi.fn()
    const listener = agentService.onAgentCreated(onAgentCreated)

    try {
      expect(() => createBuiltinSupportSession()).toThrow('forced session creation failure')
    } finally {
      listener.dispose()
    }

    expect(dbh.db.select().from(agentTable).all()).toHaveLength(0)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(0)
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(0)
    expect(onAgentCreated).not.toHaveBeenCalled()
  })
})
