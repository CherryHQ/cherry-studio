import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFindAgentIncludingDeleted,
  mockCreateAgent,
  mockUpdateAgent,
  mockProviderList,
  mockModelList,
  mockListSessions,
  mockCreateSession,
  mockEnsureHeartbeatTask,
  mockInstallBuiltinSkills,
  mockResolveAccessiblePaths,
  mockValidateAgentModels,
  mockSeedWorkspaceTemplates,
  mockInitSkillsForAgent,
  mockProvisionBuiltinAgent
} = vi.hoisted(() => ({
  mockFindAgentIncludingDeleted: vi.fn(),
  mockCreateAgent: vi.fn(),
  mockUpdateAgent: vi.fn(),
  mockProviderList: vi.fn(),
  mockModelList: vi.fn(),
  mockListSessions: vi.fn(),
  mockCreateSession: vi.fn(),
  mockEnsureHeartbeatTask: vi.fn(),
  mockInstallBuiltinSkills: vi.fn(),
  mockResolveAccessiblePaths: vi.fn(),
  mockValidateAgentModels: vi.fn(),
  mockSeedWorkspaceTemplates: vi.fn(),
  mockInitSkillsForAgent: vi.fn(),
  mockProvisionBuiltinAgent: vi.fn()
}))

vi.mock('@main/utils/builtinSkills', () => ({
  installBuiltinSkills: mockInstallBuiltinSkills
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: {
    findAgentIncludingDeleted: mockFindAgentIncludingDeleted,
    createAgent: mockCreateAgent,
    updateAgent: mockUpdateAgent
  }
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    listSessions: mockListSessions,
    createSession: mockCreateSession
  }
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    list: mockProviderList
  }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: {
    list: mockModelList
  }
}))

vi.mock('@main/services/agents/agentUtils', () => ({
  resolveAccessiblePaths: mockResolveAccessiblePaths,
  validateAgentModels: mockValidateAgentModels
}))

vi.mock('@main/services/agents/services/cherryclaw/seedWorkspace', () => ({
  seedWorkspaceTemplates: mockSeedWorkspaceTemplates
}))

vi.mock('@main/services/agents/skills/SkillService', () => ({
  skillService: {
    initSkillsForAgent: mockInitSkillsForAgent
  }
}))

vi.mock('../../SchedulerService', () => ({
  schedulerService: {
    ensureHeartbeatTask: mockEnsureHeartbeatTask
  }
}))

vi.mock('../BuiltinAgentProvisioner', () => ({
  provisionBuiltinAgent: mockProvisionBuiltinAgent
}))

describe('bootstrapBuiltinAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.resetModules()
    mockInstallBuiltinSkills.mockResolvedValue(undefined)
    mockListSessions.mockResolvedValue({ total: 0 })
    mockCreateSession.mockResolvedValue({ id: 'session_1' })
    mockEnsureHeartbeatTask.mockResolvedValue(undefined)
    mockResolveAccessiblePaths.mockReturnValue(['/tmp/workspace'])
    mockValidateAgentModels.mockResolvedValue(undefined)
    mockSeedWorkspaceTemplates.mockResolvedValue(undefined)
    mockInitSkillsForAgent.mockResolvedValue(undefined)
    mockProvisionBuiltinAgent.mockResolvedValue(undefined)
    mockCreateAgent.mockResolvedValue({ id: 'cherry-claw-default', accessiblePaths: ['/tmp/workspace'] })
    mockUpdateAgent.mockResolvedValue({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries built-in bootstrap when no model is available yet', async () => {
    // First attempt: no model for either agent → both skip. Second attempt
    // (retry): CherryClaw finds a model; CherryAssistant still has none.
    mockFindAgentIncludingDeleted.mockResolvedValue(null)
    // Each bootstrap call does `providerService.list({ endpointType })` then
    // `modelService.list({ providerId })` for each returned provider. We
    // simulate "no Anthropic-capable provider at all" by returning [] from
    // providerService.list (so modelService.list is never called), and
    // "one provider with one model" on the retry.
    mockProviderList
      .mockResolvedValueOnce([]) // CherryClaw: no providers
      .mockResolvedValueOnce([]) // CherryAssistant: no providers
      .mockResolvedValueOnce([{ id: 'anthropic' }]) // CherryClaw retry: provider found
      .mockResolvedValueOnce([]) // CherryAssistant retry: still none
    mockModelList.mockResolvedValueOnce([{ id: 'claude-3-5-sonnet' }]) // for the retry

    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()
    expect(mockCreateAgent).not.toHaveBeenCalled()
    expect(mockCreateSession).not.toHaveBeenCalled()

    // After retry delay, model is available
    await vi.advanceTimersByTimeAsync(5000)

    expect(mockCreateAgent).toHaveBeenCalledTimes(1)
    expect(mockListSessions).toHaveBeenCalledWith('cherry-claw-default', { limit: 1 })
    expect(mockCreateSession).toHaveBeenCalledWith('cherry-claw-default', {})
    expect(mockEnsureHeartbeatTask).toHaveBeenCalledWith('cherry-claw-default', 30)
  })

  it('does not retry built-in agents deleted by the user', async () => {
    // Both agents are soft-deleted
    mockFindAgentIncludingDeleted.mockResolvedValue({ id: 'some-id', deletedAt: Date.now() })

    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()
    await vi.advanceTimersByTimeAsync(60000)

    expect(mockCreateAgent).not.toHaveBeenCalled()
    expect(mockCreateSession).not.toHaveBeenCalled()
    expect(mockEnsureHeartbeatTask).not.toHaveBeenCalled()
  })

  it('syncs an existing built-in agent with its stored workspace path', async () => {
    mockListSessions.mockResolvedValue({ total: 1 })
    mockFindAgentIncludingDeleted.mockImplementation(async (id: string) => {
      if (id === 'cherry-claw-default') {
        return { id, deletedAt: Date.now() }
      }
      return { id, accessiblePaths: ['/existing/assistant-workspace'] }
    })
    mockProvisionBuiltinAgent.mockResolvedValue({
      description: 'Updated description',
      instructions: 'Updated instructions'
    })

    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()

    expect(mockResolveAccessiblePaths).not.toHaveBeenCalled()
    expect(mockProvisionBuiltinAgent).toHaveBeenCalledWith('/existing/assistant-workspace', 'assistant')
    expect(mockUpdateAgent).toHaveBeenCalledWith('cherry-assistant-default', {
      description: 'Updated description',
      instructions: 'Updated instructions'
    })
  })

  it('backfills a generated workspace path for an existing built-in agent that has none', async () => {
    mockListSessions.mockResolvedValue({ total: 1 })
    mockFindAgentIncludingDeleted.mockImplementation(async (id: string) => {
      if (id === 'cherry-claw-default') {
        return { id, deletedAt: Date.now() }
      }
      return { id, accessiblePaths: [] }
    })

    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()

    expect(mockResolveAccessiblePaths).toHaveBeenCalledWith([])
    expect(mockProvisionBuiltinAgent).toHaveBeenCalledWith('/tmp/workspace', 'assistant')
    expect(mockUpdateAgent).toHaveBeenCalledWith('cherry-assistant-default', {
      accessiblePaths: ['/tmp/workspace']
    })
  })
})
