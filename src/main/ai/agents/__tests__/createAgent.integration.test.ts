// Registers itself in the data service registry, which AgentService resolves lazily on create.
import '@data/services/AgentGlobalSkillService'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionService } from '@data/services/AgentSessionService'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createAgentDataDirectory, removeAgentDataDirectory } = vi.hoisted(() => ({
  createAgentDataDirectory: vi.fn(),
  removeAgentDataDirectory: vi.fn()
}))

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))
vi.mock('../agentDataDirectory', () => ({ createAgentDataDirectory, removeAgentDataDirectory }))

import { createAgent } from '../createAgent'

describe('createAgent (database)', () => {
  const dbh = setupTestDatabase()
  const request = {
    type: 'claude-code' as const,
    name: 'Tool created agent',
    model: 'anthropic::claude-sonnet' as const
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.mocked(application.getPath).mockReturnValue('/tmp/agents')
    createAgentDataDirectory.mockResolvedValue('/tmp/agents/agent')
    // agent.model is an FK to user_model — seed the chain.
    dbh.db.insert(userProviderTable).values({ providerId: 'anthropic', name: 'Anthropic', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'anthropic::claude-sonnet',
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        presetModelId: 'claude-sonnet',
        name: 'Claude Sonnet',
        isEnabled: true,
        isHidden: false,
        orderKey: 'a0'
      })
      .run()
  })

  it('gives the new agent a system-workspace session to start a conversation in', async () => {
    const agent = await createAgent(request)

    const sessions = dbh.db.select().from(agentSessionTable).all()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ agentId: agent.id, name: '' })

    const workspaces = dbh.db.select().from(agentWorkspaceTable).all()
    expect(workspaces).toHaveLength(1)
    expect(workspaces[0]).toMatchObject({ id: sessions[0].workspaceId, type: AGENT_WORKSPACE_TYPE.SYSTEM })
  })

  it('keeps no agent behind when its first session cannot be seeded', async () => {
    vi.spyOn(agentSessionService, 'createTx').mockImplementation(() => {
      throw new Error('session insert failed')
    })

    await expect(createAgent(request)).rejects.toThrow('session insert failed')

    // A committed agent row without a session is the unreachable state this fix exists to prevent.
    expect(dbh.db.select().from(agentTable).all()).toHaveLength(0)
    expect(removeAgentDataDirectory).toHaveBeenCalled()
  })
})
