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

vi.mock('../ensureBuiltinAssistant', () => ({
  loadBuiltinAssistantEnsureInput: mocks.loadInput
}))

import { createBuiltinAssistantFeedbackSession } from '../createBuiltinAssistantFeedbackSession'

describe('createBuiltinAssistantFeedbackSession', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadInput.mockReturnValue({
      builtinRole: 'assistant',
      configuration: {
        avatar: '🍒',
        permission_mode: 'default',
        max_turns: 100,
        env_vars: {}
      },
      name: 'Cherry Assistant',
      preferredModelId: null,
      type: 'claude-code'
    })
  })

  it('atomically restores the built-in assistant and creates a fresh system session', () => {
    const session = createBuiltinAssistantFeedbackSession()

    expect(session).toMatchObject({
      agentId: expect.any(String),
      name: '',
      workspace: { type: 'system' }
    })
    expect(dbh.db.select().from(agentTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(1)
  })

  it('rolls back the restored assistant when session creation fails', () => {
    const originalCreateTx = agentSessionService.createTx.bind(agentSessionService)
    vi.spyOn(agentSessionService, 'createTx').mockImplementationOnce((tx, id, dto) => {
      originalCreateTx(tx, id, dto)
      throw new Error('forced session creation failure')
    })
    const onAgentCreated = vi.fn()
    const listener = agentService.onAgentCreated(onAgentCreated)

    try {
      expect(() => createBuiltinAssistantFeedbackSession()).toThrow('forced session creation failure')
    } finally {
      listener.dispose()
    }

    expect(dbh.db.select().from(agentTable).all()).toHaveLength(0)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(0)
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(0)
    expect(onAgentCreated).not.toHaveBeenCalled()
  })
})
