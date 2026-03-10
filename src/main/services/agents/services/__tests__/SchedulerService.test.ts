import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('../AgentService', () => ({
  agentService: {
    listAgents: vi.fn().mockResolvedValue({ agents: [], total: 0 }),
    getAgent: vi.fn()
  }
}))

vi.mock('../SessionService', () => ({
  sessionService: {
    listSessions: vi.fn().mockResolvedValue({ sessions: [], total: 0 }),
    getSession: vi.fn(),
    createSession: vi.fn().mockResolvedValue({ id: 'session-1' })
  }
}))

vi.mock('../SessionMessageService', () => ({
  sessionMessageService: {
    createSessionMessage: vi.fn()
  }
}))

vi.mock('../TaskService', () => ({
  taskService: {
    getDueTasks: vi.fn().mockResolvedValue([]),
    updateTaskAfterRun: vi.fn(),
    logTaskRun: vi.fn(),
    computeNextRun: vi.fn().mockReturnValue(null),
    updateTask: vi.fn()
  }
}))

vi.mock('../cherryclaw', () => ({
  CherryClawService: vi.fn().mockImplementation(() => ({
    heartbeatReader: { readHeartbeat: vi.fn().mockResolvedValue(undefined) }
  }))
}))

describe('SchedulerService', () => {
  let SchedulerServiceModule: any

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
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

  it('restoreSchedulers starts the poll loop', async () => {
    const service = SchedulerServiceModule.schedulerService
    await service.restoreSchedulers()
    // The poll loop should be running
    service.stopAll()
  })

  it('stopScheduler is a no-op (poll loop handles everything)', () => {
    const service = SchedulerServiceModule.schedulerService
    // Should not throw for any agent ID
    service.stopScheduler('nonexistent')
  })

  it('startScheduler starts the poll loop', () => {
    const service = SchedulerServiceModule.schedulerService
    service.startScheduler({ id: 'agent-1' })
    service.stopAll()
  })

  it('tick processes due tasks', async () => {
    const { taskService } = await import('../TaskService')
    const { agentService } = await import('../AgentService')
    const { sessionService } = await import('../SessionService')
    const { sessionMessageService } = await import('../SessionMessageService')

    const mockTask = {
      id: 'task-1',
      agent_id: 'agent-1',
      name: 'Test task',
      prompt: 'Do something',
      schedule_type: 'once' as const,
      schedule_value: new Date().toISOString(),
      context_mode: 'session' as const,
      next_run: new Date(Date.now() - 1000).toISOString(),
      last_run: null,
      last_result: null,
      status: 'active' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    vi.mocked(taskService.getDueTasks).mockResolvedValueOnce([mockTask])
    vi.mocked(agentService.getAgent).mockResolvedValueOnce({
      id: 'agent-1',
      type: 'cherry-claw',
      name: 'Test',
      model: 'claude-3',
      accessible_paths: ['/tmp/test'],
      configuration: { heartbeat_enabled: true },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    } as any)
    vi.mocked(sessionService.listSessions).mockResolvedValueOnce({
      sessions: [{ id: 'session-1' }] as any,
      total: 1
    })
    vi.mocked(sessionService.getSession).mockResolvedValueOnce({
      id: 'session-1',
      agent_id: 'agent-1'
    } as any)
    vi.mocked(sessionMessageService.createSessionMessage).mockResolvedValueOnce({
      stream: new ReadableStream({ start: (c) => c.close() }),
      completion: Promise.resolve({})
    } as any)

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
