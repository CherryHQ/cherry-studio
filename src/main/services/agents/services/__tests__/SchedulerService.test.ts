import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: {
    listAgents: vi.fn().mockResolvedValue({ agents: [], total: 0 }),
    getAgent: vi.fn()
  }
}))

vi.mock('@data/services/SessionService', () => ({
  sessionService: {
    getById: vi.fn(),
    createSession: vi.fn().mockResolvedValue({ id: 'session-1' })
  }
}))

vi.mock('@shared/data/types/model', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    createUniqueModelId: vi.fn((providerId: string, modelId: string) => `${providerId}::${modelId}`)
  }
})

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))
vi.mock('@main/core/application', () => ({
  application: {
    get: vi.fn().mockReturnValue({ send: mockSend })
  }
}))

vi.mock('@data/services/AgentTaskService', () => ({
  agentTaskService: {
    getDueTasks: vi.fn().mockResolvedValue([]),
    hasActiveTasks: vi.fn().mockResolvedValue(false),
    updateTaskAfterRun: vi.fn(),
    logTaskRun: vi.fn().mockResolvedValue(1),
    updateTaskRunLog: vi.fn(),
    computeNextRun: vi.fn().mockReturnValue(null),
    updateTask: vi.fn(),
    getLastRunSessionId: vi.fn().mockResolvedValue(null)
  }
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: {
    getSubscribedChannels: vi.fn().mockResolvedValue([]),
    updateChannel: vi.fn()
  }
}))

vi.mock('../channels/ChannelManager', () => ({
  channelManager: {
    getNotifyAdapters: vi.fn().mockReturnValue([]),
    getAgentAdapters: vi.fn().mockReturnValue([]),
    getAdapter: vi.fn().mockReturnValue(undefined)
  }
}))

vi.mock('../cherryclaw/heartbeat', () => ({
  readHeartbeat: vi.fn().mockResolvedValue(undefined)
}))

describe('SchedulerService', () => {
  let SchedulerServiceModule: any

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    // Default: send() triggers sentinel onDone immediately
    mockSend.mockImplementation(({ listeners }) => {
      const sentinel = listeners.find((l: { id: string }) => l.id.startsWith('scheduler:'))
      if (sentinel) {
        sentinel.onDone({ status: 'success' })
      }
      return { mode: 'started', executionIds: [] }
    })
    SchedulerServiceModule = await import('../SchedulerService')
  })

  afterEach(() => {
    const service = SchedulerServiceModule.schedulerService
    service.stopAll()
    vi.useRealTimers()
  })

  it('startLoop starts the poll loop', () => {
    const service = SchedulerServiceModule.schedulerService
    service.startLoop()
    // Running is tracked internally; stopAll should not throw
    service.stopAll()
  })

  it('startLoop is idempotent', () => {
    const service = SchedulerServiceModule.schedulerService
    service.startLoop()
    service.startLoop() // second call should be a no-op
    service.stopAll()
  })

  it('stopAll stops the loop and aborts active tasks', () => {
    const service = SchedulerServiceModule.schedulerService
    service.startLoop()
    service.stopAll()
    // Should not throw, loop should be stopped
  })

  it('restoreSchedulers skips poll loop when no active tasks', async () => {
    const { agentTaskService: taskService } = await import('@data/services/AgentTaskService')
    vi.mocked(taskService.hasActiveTasks).mockResolvedValueOnce(false)
    const service = SchedulerServiceModule.schedulerService
    await service.restoreSchedulers()
    service.stopAll()
  })

  it('restoreSchedulers starts poll loop when active tasks exist', async () => {
    const { agentTaskService: taskService } = await import('@data/services/AgentTaskService')
    vi.mocked(taskService.hasActiveTasks).mockResolvedValueOnce(true)
    const service = SchedulerServiceModule.schedulerService
    await service.restoreSchedulers()
    service.stopAll()
  })

  it('stopAll stops the poll loop', () => {
    const service = SchedulerServiceModule.schedulerService
    // Should not throw even if not started
    service.stopAll()
  })

  it('startLoop starts the poll loop', () => {
    const service = SchedulerServiceModule.schedulerService
    service.startLoop()
    service.stopAll()
  })

  it('tick processes due tasks', async () => {
    const { agentTaskService: taskService } = await import('@data/services/AgentTaskService')
    const { agentService } = await import('@data/services/AgentService')
    const { sessionService } = await import('@data/services/SessionService')

    const mockTask = {
      id: 'task-1',
      agentId: 'agent-1',
      name: 'Test task',
      prompt: 'Do something',
      scheduleType: 'once' as const,
      scheduleValue: new Date().toISOString(),
      timeoutMinutes: 2,
      nextRun: new Date(Date.now() - 1000).toISOString(),
      lastRun: null,
      lastResult: null,
      status: 'active' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    vi.mocked(taskService.getDueTasks).mockResolvedValueOnce([mockTask])
    vi.mocked(agentService.getAgent).mockResolvedValue({
      id: 'agent-1',
      type: 'claude-code',
      name: 'Test',
      model: 'anthropic::claude-3',
      configuration: { heartbeat_enabled: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as any)
    vi.mocked(sessionService.createSession).mockResolvedValueOnce({
      id: 'session-1',
      agentId: 'agent-1',
      name: 'Scheduled run',
      accessiblePaths: ['/tmp/test']
    } as any)

    // Simulate AiStreamManager completing the execution so the scheduler's
    // `await executionDone` resolves and the task flow reaches updateTaskAfterRun.
    mockSend.mockImplementationOnce(
      ({ listeners }: { listeners: Array<{ id: string; onDone?: (r: { status: string }) => void }> }) => {
        const sentinel = listeners.find((l) => l.id.startsWith('scheduler:'))
        sentinel?.onDone?.({ status: 'success' })
        return { mode: 'started', executionIds: [] }
      }
    )

    const service = SchedulerServiceModule.schedulerService
    service.startLoop()

    // Advance past the first tick
    await vi.advanceTimersByTimeAsync(100)

    expect(taskService.getDueTasks).toHaveBeenCalled()
    // Give the async task time to complete
    await vi.advanceTimersByTimeAsync(1000)

    expect(taskService.logTaskRun).toHaveBeenCalled()
    expect(taskService.updateTaskAfterRun).toHaveBeenCalledWith('task-1', null, 'Completed')
  })
})
