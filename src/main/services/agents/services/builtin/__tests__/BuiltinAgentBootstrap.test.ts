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

vi.mock('@main/utils/builtinSkills', () => ({
  installBuiltinSkills: mockInstallBuiltinSkills
}))

vi.mock('../../AgentService', () => ({
  agentService: {
    initDefaultCherryClawAgent: mockInitDefaultCherryClawAgent,
    initBuiltinAgent: mockInitBuiltinAgent
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
