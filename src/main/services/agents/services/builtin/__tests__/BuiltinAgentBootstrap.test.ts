import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock electron-store before any imports that use it
vi.mock('electron-store', () => {
  const Store = vi.fn(() => ({
    get: vi.fn((key: string, defaultValue?: unknown) => defaultValue),
    set: vi.fn()
  }))
  return { default: Store }
})

// Mock electron to avoid CommonJS issues
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata'),
    getLocale: vi.fn(() => 'en-US')
  }
}))

// Mock ConfigManager
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
  installBuiltinSkills: vi.fn()
}))

vi.mock('../../AgentService', () => ({
  agentService: {
    initDefaultCherryClawAgent: vi.fn().mockResolvedValue('cherry-claw-default'),
    initBuiltinAgent: vi.fn().mockResolvedValue('cherry-assistant-default'),
    agentExists: vi.fn().mockResolvedValue(true)
  }
}))

vi.mock('../../SchedulerService', () => ({
  schedulerService: {
    ensureHeartbeatTask: vi.fn()
  }
}))

vi.mock('../../SessionService', () => ({
  sessionService: {
    listSessions: vi.fn().mockResolvedValue({ total: 1 }),
    createSession: vi.fn()
  }
}))

vi.mock('../BuiltinAgentProvisioner', () => ({
  provisionBuiltinAgent: vi.fn()
}))

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

    // Should not call set if already in list (or should set same list)
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
})
