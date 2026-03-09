import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('../AgentService', () => ({
  agentService: {
    listAgents: vi.fn().mockResolvedValue({ agents: [], total: 0 }),
    getAgent: vi.fn(),
    updateAgent: vi.fn()
  }
}))

vi.mock('../SessionService', () => ({
  sessionService: {
    listSessions: vi.fn().mockResolvedValue({ sessions: [], total: 0 }),
    getSession: vi.fn()
  }
}))

vi.mock('../SessionMessageService', () => ({
  sessionMessageService: {
    createSessionMessage: vi.fn()
  }
}))

vi.mock('../cherryclaw', () => ({
  CherryClawService: vi.fn().mockImplementation(() => ({
    heartbeatReader: { readHeartbeat: vi.fn() }
  }))
}))

vi.mock('cron-parser', () => ({
  CronExpressionParser: {
    parse: vi.fn().mockReturnValue({
      next: () => ({ toDate: () => new Date(Date.now() + 60000) })
    })
  }
}))

import type { AgentEntity, CherryClawConfiguration } from '@types'

function createMockAgent(overrides: Partial<AgentEntity> = {}): AgentEntity {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    type: 'cherry-claw',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    configuration: {
      scheduler_enabled: true,
      scheduler_type: 'interval',
      scheduler_interval: 60
    } as CherryClawConfiguration,
    ...overrides
  } as AgentEntity
}

describe('SchedulerService', () => {
  let SchedulerServiceClass: any

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    SchedulerServiceClass = await import('../SchedulerService')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function getService() {
    // Access the class via the module to create a fresh singleton each time
    // Since we reset modules in beforeEach, getInstance() returns a new instance
    return SchedulerServiceClass.schedulerService
  }

  it('startScheduler creates a timer for interval type', () => {
    const service = getService()
    const agent = createMockAgent()

    service.startScheduler(agent)

    expect(service.isRunning('agent-1')).toBe(true)
    const status = service.getSchedulerStatus('agent-1')
    expect(status).not.toBeNull()
    expect(status!.running).toBe(true)
    expect(status!.type).toBe('interval')
    expect(status!.nextRun).toBeInstanceOf(Date)
  })

  it('stopScheduler clears the timer', () => {
    const service = getService()
    const agent = createMockAgent()

    service.startScheduler(agent)
    expect(service.isRunning('agent-1')).toBe(true)

    service.stopScheduler('agent-1')
    expect(service.isRunning('agent-1')).toBe(false)
    expect(service.getSchedulerStatus('agent-1')).toBeNull()
  })

  it('stopAll clears all schedulers', () => {
    const service = getService()

    const agent1 = createMockAgent({ id: 'agent-1' })
    const agent2 = createMockAgent({
      id: 'agent-2',
      configuration: {
        scheduler_enabled: true,
        scheduler_type: 'interval',
        scheduler_interval: 120
      } as CherryClawConfiguration
    })

    service.startScheduler(agent1)
    service.startScheduler(agent2)

    expect(service.isRunning('agent-1')).toBe(true)
    expect(service.isRunning('agent-2')).toBe(true)

    service.stopAll()

    expect(service.isRunning('agent-1')).toBe(false)
    expect(service.isRunning('agent-2')).toBe(false)
  })

  it('isRunning returns correct state', () => {
    const service = getService()

    expect(service.isRunning('nonexistent')).toBe(false)

    const agent = createMockAgent()
    service.startScheduler(agent)
    expect(service.isRunning('agent-1')).toBe(true)

    service.stopScheduler('agent-1')
    expect(service.isRunning('agent-1')).toBe(false)
  })

  it('getSchedulerStatus returns null for unknown agent', () => {
    const service = getService()
    expect(service.getSchedulerStatus('unknown-agent')).toBeNull()
  })

  it('getSchedulerStatus returns status for running scheduler', () => {
    const service = getService()
    const agent = createMockAgent()

    service.startScheduler(agent)

    const status = service.getSchedulerStatus('agent-1')
    expect(status).not.toBeNull()
    expect(status!.running).toBe(true)
    expect(status!.type).toBe('interval')
    expect(status!.tickInProgress).toBe(false)
    expect(status!.consecutiveErrors).toBe(0)
    expect(status!.nextRun).toBeInstanceOf(Date)
    expect(status!.lastRun).toBeUndefined()
  })

  it('tick guard prevents overlapping ticks', async () => {
    const service = getService()
    const agent = createMockAgent({
      configuration: {
        scheduler_enabled: true,
        scheduler_type: 'interval',
        scheduler_interval: 10 // 10 seconds
      } as CherryClawConfiguration
    })

    service.startScheduler(agent)

    // Access the private schedulers map to simulate tickInProgress
    // We use getSchedulerStatus to verify initial state, then manipulate via the map
    const status = service.getSchedulerStatus('agent-1')
    expect(status!.tickInProgress).toBe(false)

    // Access internal state to set tickInProgress = true before the timer fires

    const schedulers = (service as any).schedulers as Map<string, { tickInProgress: boolean }>
    const entry = schedulers.get('agent-1')!
    entry.tickInProgress = true

    // Advance timers to trigger the tick
    await vi.advanceTimersByTimeAsync(10_000)

    // The tick should have been skipped because tickInProgress was true
    // tickInProgress should still be true (the guard returned early, didn't reset it)
    const statusAfter = service.getSchedulerStatus('agent-1')
    expect(statusAfter!.tickInProgress).toBe(true)
  })

  it('startScheduler does nothing when scheduler is not enabled', () => {
    const service = getService()
    const agent = createMockAgent({
      configuration: {
        scheduler_enabled: false,
        scheduler_type: 'interval',
        scheduler_interval: 60
      } as CherryClawConfiguration
    })

    service.startScheduler(agent)
    expect(service.isRunning('agent-1')).toBe(false)
  })

  it('startScheduler stops existing scheduler before creating new one', () => {
    const service = getService()
    const agent = createMockAgent()

    service.startScheduler(agent)
    const statusBefore = service.getSchedulerStatus('agent-1')

    // Start again with different interval
    const agentUpdated = createMockAgent({
      configuration: {
        scheduler_enabled: true,
        scheduler_type: 'interval',
        scheduler_interval: 120
      } as CherryClawConfiguration
    })
    service.startScheduler(agentUpdated)

    const statusAfter = service.getSchedulerStatus('agent-1')
    expect(statusAfter).not.toBeNull()
    expect(statusAfter!.running).toBe(true)
    // The nextRun should reflect the new interval
    expect(statusAfter!.nextRun!.getTime()).not.toBe(statusBefore!.nextRun!.getTime())
  })
})
