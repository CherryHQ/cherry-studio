import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { CHERRY_SUPPORT_AGENT_ID } from '@shared/ai/builtinAgent'

const mocks = vi.hoisted(() => ({
  loadInput: vi.fn(),
  notifyDataApiDataChange: vi.fn()
}))

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: mocks.notifyDataApiDataChange }))

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
      agentId: CHERRY_SUPPORT_AGENT_ID,
      name: '',
      workspace: { type: 'system' }
    })
    expect(dbh.db.select().from(agentTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(1)
    expect(mocks.notifyDataApiDataChange).toHaveBeenCalledExactlyOnceWith([
      { endpoint: '/agent-sessions', kind: 'membership', entityIds: [session.id] },
      { endpoint: '/agent-sessions', kind: 'order', dimension: 'lastActivityAt', entityIds: [session.id] },
      { endpoint: '/agent-sessions/:sessionId', entityIds: [session.id] },
      { endpoint: '/agent-sessions/latest' }
    ])
  })

  it('reuses the active Cherry Support role but creates a new session for every request', () => {
    const first = createBuiltinSupportSession()
    const second = createBuiltinSupportSession()

    expect(first.id).not.toBe(second.id)
    expect(first.agentId).toBe(second.agentId)
    expect(dbh.db.select().from(agentTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(2)
  })

  it('isolates a forged legacy role before creating the official Support session', () => {
    dbh.db
      .insert(agentTable)
      .values({
        id: 'forged-support',
        type: 'claude-code',
        name: 'User Agent',
        instructions: 'User instructions',
        orderKey: 'a0',
        configuration: { builtin_role: 'support', avatar: 'U' }
      })
      .run()

    const session = createBuiltinSupportSession()

    expect(session.agentId).toBe(CHERRY_SUPPORT_AGENT_ID)
    const [ordinary] = dbh.db.select().from(agentTable).where(eq(agentTable.id, 'forged-support')).all()
    expect(ordinary).toMatchObject({ name: 'User Agent', instructions: 'User instructions' })
    expect(ordinary.configuration).toEqual({ avatar: 'U' })
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
    expect(mocks.notifyDataApiDataChange).not.toHaveBeenCalled()
  })

  it('rolls back claiming and restoring an existing reserved row when session creation fails', () => {
    const deletedAt = Date.UTC(2026, 0, 1)
    dbh.db
      .insert(agentTable)
      .values({
        id: CHERRY_SUPPORT_AGENT_ID,
        type: 'claude-code',
        name: 'Reserved User Agent',
        description: 'Keep description',
        instructions: 'Keep instructions',
        orderKey: 'a0',
        deletedAt,
        configuration: { avatar: 'U' }
      })
      .run()
    const originalCreateTx = agentSessionService.createTx.bind(agentSessionService)
    vi.spyOn(agentSessionService, 'createTx').mockImplementationOnce((tx, id, dto) => {
      originalCreateTx(tx, id, dto)
      throw new Error('forced session creation failure')
    })

    expect(() => createBuiltinSupportSession()).toThrow('forced session creation failure')

    const [existing] = dbh.db.select().from(agentTable).where(eq(agentTable.id, CHERRY_SUPPORT_AGENT_ID)).all()
    expect(existing).toMatchObject({
      name: 'Reserved User Agent',
      description: 'Keep description',
      instructions: 'Keep instructions',
      deletedAt,
      configuration: { avatar: 'U' }
    })
    expect(existing.configuration).not.toHaveProperty('builtin_role')
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(0)
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(0)
    expect(mocks.notifyDataApiDataChange).not.toHaveBeenCalled()
  })
})
