import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'

const mocks = vi.hoisted(() => ({
  loadInput: vi.fn()
}))

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))

vi.mock('../ensureBuiltinAgent', () => ({
  loadBuiltinAgentEnsureInput: mocks.loadInput
}))

import { createBuiltinAssistantSession } from '../createBuiltinAssistantSession'

describe('createBuiltinAssistantSession', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadInput.mockReturnValue({
      builtinRole: 'assistant',
      configuration: { avatar: '🍒', permission_mode: 'default', env_vars: {} },
      name: 'Cherry Assistant',
      preferredModelId: null,
      type: 'claude-code'
    })
  })

  it('restores Cherry Assistant and creates a fresh system session on it', () => {
    const session = createBuiltinAssistantSession()

    const [agent] = dbh.db.select().from(agentTable).all()
    expect(agent.configuration).toMatchObject({ builtin_role: 'assistant' })
    expect(session).toMatchObject({ agentId: agent.id, name: '', workspace: { type: 'system' } })
  })

  it('reuses Cherry Assistant but creates a new session for every request', () => {
    const first = createBuiltinAssistantSession()
    const second = createBuiltinAssistantSession()

    expect(first.id).not.toBe(second.id)
    expect(first.agentId).toBe(second.agentId)
    expect(dbh.db.select().from(agentTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(2)
  })
})
