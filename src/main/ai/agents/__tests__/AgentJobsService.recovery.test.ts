import { BaseService } from '@main/core/lifecycle/BaseService'
import { ServiceContainer } from '@main/core/lifecycle/ServiceContainer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agentExists: vi.fn(),
  notifyReadModelChange: vi.fn(),
  onAgentDeleted: vi.fn(() => ({ dispose: vi.fn() })),
  registerHandler: vi.fn(),
  schedules: [] as Array<{ id: string; jobInputTemplate: unknown }>,
  unregisterJobScheduleById: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'JobManager') {
        return {
          registerHandler: mocks.registerHandler,
          unregisterJobScheduleById: mocks.unregisterJobScheduleById
        }
      }
      throw new Error(`Unexpected application.get('${name}')`)
    })
  }
}))

vi.mock('@data/services/AgentChannelService', () => ({ agentChannelService: {} }))
vi.mock('@data/services/AgentService', () => ({
  agentService: {
    agentExists: mocks.agentExists,
    onAgentDeleted: mocks.onAgentDeleted
  }
}))
vi.mock('@data/services/AgentSessionService', () => ({ agentSessionService: {} }))
vi.mock('@data/services/AgentTaskService', () => ({
  agentTaskService: { notifyReadModelChange: mocks.notifyReadModelChange },
  HEARTBEAT_PROMPT_SENTINEL: '__heartbeat__',
  normalizeTaskSessionReuseRevision: (value: unknown) => (typeof value === 'number' ? value : 0),
  readTaskSessionReuse: () => ({ enabled: false, revision: 0 }),
  writeTaskSessionReuse: () => ({})
}))
vi.mock('@data/services/JobScheduleService', () => ({
  jobScheduleService: {
    listAll: () => mocks.schedules
  }
}))
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn() })
  }
}))
vi.mock('../agentTaskJobHandler', () => ({ agentTaskJobHandler: {} }))

import { AgentJobsService } from '../AgentJobsService'

function schedule(id: string, agentId: string) {
  return {
    id,
    jobInputTemplate: {
      agentId,
      prompt: 'scheduled task',
      timeoutMinutes: 2,
      workspace: { type: 'system' },
      reuseRevision: 0
    }
  }
}

describe('AgentJobsService startup reconciliation', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    ServiceContainer.reset()
    mocks.agentExists.mockReset()
    mocks.notifyReadModelChange.mockReset()
    mocks.onAgentDeleted.mockClear()
    mocks.registerHandler.mockReset()
    mocks.schedules = []
    mocks.unregisterJobScheduleById.mockReset()
  })

  it('is fail-fast so cleanup failure cannot fall through to startup recovery', () => {
    const container = ServiceContainer.getInstance()
    container.register(AgentJobsService)

    expect(container.getMetadata('AgentJobsService')?.errorStrategy).toBe('fail-fast')
  })

  it('removes orphaned agent tasks during service startup and keeps valid schedules', async () => {
    mocks.schedules = [
      schedule('valid', 'agent-live'),
      schedule('orphan', 'agent-missing'),
      { id: 'malformed', jobInputTemplate: { agentId: 'agent-missing' } }
    ]
    mocks.agentExists.mockImplementation((agentId: string) => agentId === 'agent-live')
    mocks.unregisterJobScheduleById.mockResolvedValue(true)

    const service = new AgentJobsService()
    await service._doInit()

    expect(mocks.unregisterJobScheduleById).toHaveBeenCalledTimes(1)
    expect(mocks.unregisterJobScheduleById).toHaveBeenCalledWith('orphan')
    expect(mocks.notifyReadModelChange).toHaveBeenCalledWith(['orphan'])
  })

  it('rejects initialization when orphan cleanup fails', async () => {
    mocks.schedules = [schedule('orphan', 'agent-missing')]
    mocks.agentExists.mockReturnValue(false)
    mocks.unregisterJobScheduleById.mockRejectedValue(new Error('schedule delete failed'))

    const service = new AgentJobsService()

    await expect(service._doInit()).rejects.toThrow('schedule delete failed')
  })

  it('is idempotent after the orphan has been removed', async () => {
    mocks.schedules = [schedule('orphan', 'agent-missing')]
    mocks.agentExists.mockReturnValue(false)
    mocks.unregisterJobScheduleById.mockImplementation(async (scheduleId: string) => {
      mocks.schedules = mocks.schedules.filter((candidate) => candidate.id !== scheduleId)
      return true
    })

    const service = new AgentJobsService()

    await expect(service.reconcileOrphanedSchedules()).resolves.toBe(1)
    await expect(service.reconcileOrphanedSchedules()).resolves.toBe(0)
    expect(mocks.unregisterJobScheduleById).toHaveBeenCalledTimes(1)
  })

  it('does not finish initialization until orphan cleanup settles', async () => {
    mocks.schedules = [schedule('orphan', 'agent-missing')]
    mocks.agentExists.mockReturnValue(false)

    let releaseCleanup: (() => void) | undefined
    mocks.unregisterJobScheduleById.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          releaseCleanup = () => resolve(true)
        })
    )

    const service = new AgentJobsService()
    let initialized = false
    const init = service._doInit().then(() => {
      initialized = true
    })

    await vi.waitFor(() => expect(mocks.unregisterJobScheduleById).toHaveBeenCalledWith('orphan'))
    expect(initialized).toBe(false)

    releaseCleanup?.()
    await init
    expect(initialized).toBe(true)
  })
})
