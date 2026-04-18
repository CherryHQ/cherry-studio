import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockInstallBuiltinSkills,
  mockInitDefaultCherryClawAgent,
  mockInitBuiltinAgent,
  mockListSessions,
  mockCreateSession,
  mockEnsureHeartbeatTask
} = vi.hoisted(() => ({
  mockInstallBuiltinSkills: vi.fn(),
  mockInitDefaultCherryClawAgent: vi.fn(),
  mockInitBuiltinAgent: vi.fn(),
  mockListSessions: vi.fn(),
  mockCreateSession: vi.fn(),
  mockEnsureHeartbeatTask: vi.fn()
}))

// Mock ConfigManager for hide/show/restore tests
const mockGetDismissed = vi.fn<() => string[]>().mockReturnValue([])
const mockSetDismissed = vi.fn()

vi.mock('@main/services/ConfigManager', () => ({
  configManager: {
    getDismissedBuiltinAgents: mockGetDismissed,
    setDismissedBuiltinAgents: mockSetDismissed
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@main/utils/builtinSkills', () => ({
  installBuiltinSkills: mockInstallBuiltinSkills
}))

vi.mock('../../AgentService', () => ({
  agentService: {
    initDefaultCherryClawAgent: mockInitDefaultCherryClawAgent,
    initBuiltinAgent: mockInitBuiltinAgent,
    agentExists: vi.fn().mockResolvedValue(true)
  }
}))

vi.mock('../../SessionService', () => ({
  sessionService: {
    listSessions: mockListSessions,
    createSession: mockCreateSession
  }
}))

vi.mock('../../SchedulerService', () => ({
  schedulerService: {
    ensureHeartbeatTask: mockEnsureHeartbeatTask
  }
}))

vi.mock('../BuiltinAgentProvisioner', () => ({
  provisionBuiltinAgent: vi.fn()
}))

// ── Bootstrap tests (from main) ─────────────────────────────────────

describe('bootstrapBuiltinAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.resetModules()
    mockInstallBuiltinSkills.mockResolvedValue(undefined)
    mockListSessions.mockResolvedValue({ total: 0 })
    mockCreateSession.mockResolvedValue({ id: 'session_1' })
    mockEnsureHeartbeatTask.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries built-in bootstrap when no model is available yet', async () => {
    mockInitDefaultCherryClawAgent
      .mockResolvedValueOnce({ agentId: null, skippedReason: 'no_model' })
      .mockResolvedValueOnce({ agentId: 'cherry-claw-default' })
    mockInitBuiltinAgent.mockResolvedValue({ agentId: null, skippedReason: 'deleted' })

    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()
    expect(mockInitDefaultCherryClawAgent).toHaveBeenCalledTimes(1)
    expect(mockCreateSession).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5000)

    expect(mockInitDefaultCherryClawAgent).toHaveBeenCalledTimes(2)
    expect(mockListSessions).toHaveBeenCalledWith('cherry-claw-default', { limit: 1 })
    expect(mockCreateSession).toHaveBeenCalledWith('cherry-claw-default', {})
    expect(mockEnsureHeartbeatTask).toHaveBeenCalledWith('cherry-claw-default', 30)
  })

  it('does not retry built-in agents deleted by the user', async () => {
    mockInitDefaultCherryClawAgent.mockResolvedValue({ agentId: null, skippedReason: 'deleted' })
    mockInitBuiltinAgent.mockResolvedValue({ agentId: null, skippedReason: 'deleted' })

    const { bootstrapBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await bootstrapBuiltinAgents()
    await vi.advanceTimersByTimeAsync(60000)

    expect(mockInitDefaultCherryClawAgent).toHaveBeenCalledTimes(1)
    expect(mockInitBuiltinAgent).toHaveBeenCalledTimes(1)
    expect(mockCreateSession).not.toHaveBeenCalled()
    expect(mockEnsureHeartbeatTask).not.toHaveBeenCalled()
  })
})

// ── Utility tests (our branch) ──────────────────────────────────────

describe('BuiltinAgentBootstrap utilities', () => {
  describe('BUILTIN_AGENT_IDS', () => {
    it('contains cherry-claw-default and cherry-assistant-default', async () => {
      const { BUILTIN_AGENT_IDS } = await import('../BuiltinAgentBootstrap')
      expect(BUILTIN_AGENT_IDS).toContain('cherry-claw-default')
      expect(BUILTIN_AGENT_IDS).toContain('cherry-assistant-default')
      expect(BUILTIN_AGENT_IDS).toHaveLength(2)
    })
  })

  describe('isBuiltinAgentId', () => {
    it('returns true for cherry-claw-default', async () => {
      const { isBuiltinAgentId } = await import('../BuiltinAgentBootstrap')
      expect(isBuiltinAgentId('cherry-claw-default')).toBe(true)
    })

    it('returns true for cherry-assistant-default', async () => {
      const { isBuiltinAgentId } = await import('../BuiltinAgentBootstrap')
      expect(isBuiltinAgentId('cherry-assistant-default')).toBe(true)
    })

    it('returns false for custom agent IDs', async () => {
      const { isBuiltinAgentId } = await import('../BuiltinAgentBootstrap')
      expect(isBuiltinAgentId('agent_12345_abc')).toBe(false)
      expect(isBuiltinAgentId('my-custom-agent')).toBe(false)
      expect(isBuiltinAgentId('')).toBe(false)
    })

    it('returns false for IDs that merely contain "cherry"', async () => {
      const { isBuiltinAgentId } = await import('../BuiltinAgentBootstrap')
      expect(isBuiltinAgentId('cherry-custom')).toBe(false)
      expect(isBuiltinAgentId('cherry-claw-default-extra')).toBe(false)
    })
  })
})

// ── Hide/Show/Restore tests (our branch) ────────────────────────────

describe('hide/show builtin agents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetDismissed.mockReturnValue([])
  })

  it('hideBuiltinAgent adds ID to dismissed list', async () => {
    const { hideBuiltinAgent } = await import('../BuiltinAgentBootstrap')

    hideBuiltinAgent('cherry-claw-default')

    expect(mockSetDismissed).toHaveBeenCalledWith(['cherry-claw-default'])
  })

  it('hideBuiltinAgent does not duplicate IDs', async () => {
    mockGetDismissed.mockReturnValue(['cherry-claw-default'])
    const { hideBuiltinAgent } = await import('../BuiltinAgentBootstrap')

    hideBuiltinAgent('cherry-claw-default')

    expect(mockSetDismissed).not.toHaveBeenCalled()
  })

  it('hideBuiltinAgent throws for non-builtin IDs', async () => {
    const { hideBuiltinAgent } = await import('../BuiltinAgentBootstrap')

    expect(() => hideBuiltinAgent('custom-agent-123')).toThrow('Not a builtin agent ID: custom-agent-123')
  })

  it('showBuiltinAgent removes ID from dismissed list', async () => {
    mockGetDismissed.mockReturnValue(['cherry-claw-default', 'cherry-assistant-default'])
    const { showBuiltinAgent } = await import('../BuiltinAgentBootstrap')

    showBuiltinAgent('cherry-claw-default')

    expect(mockSetDismissed).toHaveBeenCalledWith(['cherry-assistant-default'])
  })

  it('showBuiltinAgent throws for non-builtin IDs', async () => {
    const { showBuiltinAgent } = await import('../BuiltinAgentBootstrap')

    expect(() => showBuiltinAgent('custom-agent-123')).toThrow('Not a builtin agent ID: custom-agent-123')
  })

  it('getHiddenBuiltinAgents returns dismissed list', async () => {
    mockGetDismissed.mockReturnValue(['cherry-claw-default'])
    const { getHiddenBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    const result = getHiddenBuiltinAgents()

    expect(result).toEqual(['cherry-claw-default'])
    expect(mockGetDismissed).toHaveBeenCalled()
  })

  it('restoreBuiltinAgents clears hidden list', async () => {
    const { restoreBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    await restoreBuiltinAgents()

    expect(mockSetDismissed).toHaveBeenCalledWith([])
  })

  it('restoreBuiltinAgents returns IDs of agents confirmed in DB', async () => {
    const { agentService } = await import('../../AgentService')
    const { restoreBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    const result = await restoreBuiltinAgents()

    expect(agentService.agentExists).toHaveBeenCalledTimes(2)
    expect(result).toEqual(['cherry-claw-default', 'cherry-assistant-default'])
  })

  it('restoreBuiltinAgents returns only existing IDs when some inits fail', async () => {
    const { agentService } = await import('../../AgentService')
    const { restoreBuiltinAgents } = await import('../BuiltinAgentBootstrap')

    vi.mocked(agentService.agentExists)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    const result = await restoreBuiltinAgents()

    expect(result).toEqual(['cherry-claw-default'])
  })
})
