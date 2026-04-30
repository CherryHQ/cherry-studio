import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateAgent,
  mockGetModels,
  mockResolveAccessiblePaths,
  mockValidateAgentModels,
  mockSeedWorkspaceTemplates,
  mockInitSkillsForAgent,
  mockProvisionBuiltinAgent
} = vi.hoisted(() => ({
  mockCreateAgent: vi.fn(),
  mockGetModels: vi.fn(),
  mockResolveAccessiblePaths: vi.fn(),
  mockValidateAgentModels: vi.fn(),
  mockSeedWorkspaceTemplates: vi.fn(),
  mockInitSkillsForAgent: vi.fn(),
  mockProvisionBuiltinAgent: vi.fn()
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: {
    createAgent: mockCreateAgent,
    updateAgent: vi.fn()
  }
}))

vi.mock('@main/apiServer/services/models', () => ({
  modelsService: {
    getModels: mockGetModels
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

vi.mock('../BuiltinAgentProvisioner', () => ({
  provisionBuiltinAgent: mockProvisionBuiltinAgent
}))

describe('initCherryClaw', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveAccessiblePaths.mockReturnValue(['/tmp/workspace'])
    mockValidateAgentModels.mockResolvedValue(undefined)
    mockSeedWorkspaceTemplates.mockResolvedValue(undefined)
    mockInitSkillsForAgent.mockResolvedValue(undefined)
    mockCreateAgent.mockResolvedValue({ id: 'new-uuid-1234', accessiblePaths: ['/tmp/workspace'] })
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('creates agent when a model is available', async () => {
    mockGetModels.mockResolvedValue({ data: [{ id: 'claude-3-5-sonnet' }] })

    const { initCherryClaw } = await import('../BuiltinAgentBootstrap')
    const result = await initCherryClaw()

    expect(result.agentId).toBe('new-uuid-1234')
    expect(mockCreateAgent).toHaveBeenCalledTimes(1)
  })

  it('returns no_model when no Anthropic model is available', async () => {
    mockGetModels.mockResolvedValue({ data: [] })

    const { initCherryClaw } = await import('../BuiltinAgentBootstrap')
    const result = await initCherryClaw()

    expect(result.agentId).toBeNull()
    expect(result.skippedReason).toBe('no_model')
    expect(mockCreateAgent).not.toHaveBeenCalled()
  })
})

describe('initBuiltinAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveAccessiblePaths.mockReturnValue(['/tmp/workspace'])
    mockValidateAgentModels.mockResolvedValue(undefined)
    mockInitSkillsForAgent.mockResolvedValue(undefined)
    mockProvisionBuiltinAgent.mockResolvedValue({ description: 'Test', instructions: 'Be helpful.' })
    mockCreateAgent.mockResolvedValue({ id: 'new-uuid-5678', accessiblePaths: ['/tmp/workspace'] })
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('creates agent with provisioned config when a model is available', async () => {
    mockGetModels.mockResolvedValue({ data: [{ id: 'claude-3-5-sonnet' }] })

    const { initBuiltinAgent } = await import('../BuiltinAgentBootstrap')
    const result = await initBuiltinAgent({ builtinRole: 'assistant' })

    expect(result.agentId).toBe('new-uuid-5678')
    expect(mockCreateAgent).toHaveBeenCalledTimes(1)
    expect(mockProvisionBuiltinAgent).toHaveBeenCalledWith('/tmp/workspace', 'assistant')
  })

  it('returns no_model when no Anthropic model is available', async () => {
    mockGetModels.mockResolvedValue({ data: [] })

    const { initBuiltinAgent } = await import('../BuiltinAgentBootstrap')
    const result = await initBuiltinAgent({ builtinRole: 'assistant' })

    expect(result.agentId).toBeNull()
    expect(result.skippedReason).toBe('no_model')
    expect(mockCreateAgent).not.toHaveBeenCalled()
  })
})
