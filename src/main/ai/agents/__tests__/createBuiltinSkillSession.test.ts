import { agentTable } from '@data/db/schemas/agent'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionService } from '@data/services/AgentSessionService'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadInput: vi.fn(),
  notifyDataApiDataChange: vi.fn()
}))

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: mocks.notifyDataApiDataChange }))

vi.mock('../ensureBuiltinAgent', () => ({
  loadBuiltinAgentEnsureInput: mocks.loadInput
}))

import { createBuiltinSkillSession } from '../createBuiltinSkillSession'

describe('createBuiltinSkillSession', () => {
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

  function seedSkill(isEnabled = true) {
    dbh.db
      .insert(agentGlobalSkillTable)
      .values({
        id: 'skill-1',
        name: 'Writer',
        folderName: 'writer',
        source: 'local',
        contentHash: 'hash',
        isEnabled
      })
      .run()
  }

  it('restores Cherry Assistant, enables the target Skill, and creates one system session atomically', () => {
    seedSkill()

    const session = createBuiltinSkillSession('skill-1')

    expect(session).toMatchObject({ name: '', workspace: { type: 'system' } })
    expect(dbh.db.select().from(agentTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentSkillTable).all()).toEqual([
      expect.objectContaining({ agentId: session.agentId, skillId: 'skill-1', isEnabled: true })
    ])
    expect(mocks.notifyDataApiDataChange).toHaveBeenCalledWith([
      { endpoint: '/agents', kind: 'membership', entityIds: [session.agentId] }
    ])
    expect(mocks.notifyDataApiDataChange).toHaveBeenCalledWith([
      { endpoint: '/skills', kind: 'membership', dimension: 'agentId', entityIds: ['skill-1'] }
    ])
    expect(mocks.notifyDataApiDataChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        { endpoint: '/agent-sessions', kind: 'membership', entityIds: [session.id] },
        { endpoint: '/agent-sessions/:sessionId', entityIds: [session.id] }
      ])
    )
  })

  it('rejects a disabled Skill before creating any Agent or Session', () => {
    seedSkill(false)

    expect(() => createBuiltinSkillSession('skill-1')).toThrow('globally disabled')

    expect(dbh.db.select().from(agentTable).all()).toHaveLength(0)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(0)
    expect(dbh.db.select().from(agentSkillTable).all()).toHaveLength(0)
    expect(mocks.notifyDataApiDataChange).not.toHaveBeenCalled()
  })

  it('rolls back the Agent, association, workspace, and Session before publishing when Session creation fails', () => {
    seedSkill()
    const originalCreateTx = agentSessionService.createTx.bind(agentSessionService)
    vi.spyOn(agentSessionService, 'createTx').mockImplementationOnce((tx, id, dto) => {
      originalCreateTx(tx, id, dto)
      throw new Error('forced session creation failure')
    })

    expect(() => createBuiltinSkillSession('skill-1')).toThrow('forced session creation failure')

    expect(dbh.db.select().from(agentTable).all()).toHaveLength(0)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(0)
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(0)
    expect(dbh.db.select().from(agentSkillTable).all()).toHaveLength(0)
    expect(mocks.notifyDataApiDataChange).not.toHaveBeenCalled()
  })
})
