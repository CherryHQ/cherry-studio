import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle/BaseService'

const mocks = vi.hoisted(() => ({
  agentCreated: vi.fn(() => ({ dispose: vi.fn() })),
  agentUpdated: vi.fn(() => ({ dispose: vi.fn() })),
  pause: vi.fn(() => ({ dispose: vi.fn() })),
  reapOrphanedScheduleRows: vi.fn(),
  registerHandler: vi.fn(),
  schedules: [] as Array<{ id: string; jobInputTemplate: unknown }>
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    JobManager: {
      pause: mocks.pause,
      registerHandler: mocks.registerHandler
    }
  })
})

vi.mock('@data/services/AgentChannelService', () => ({ agentChannelService: {} }))
vi.mock('@data/services/AgentService', () => ({
  agentService: {
    onAgentCreated: mocks.agentCreated,
    onAgentUpdated: mocks.agentUpdated
  }
}))
vi.mock('@data/services/AgentSessionService', () => ({ agentSessionService: {} }))
vi.mock('@data/services/AgentTaskService', () => ({
  agentTaskService: {},
  HEARTBEAT_PROMPT_SENTINEL: '__heartbeat__',
  normalizeTaskSessionReuseRevision: (value: unknown) => (typeof value === 'number' ? value : 0),
  readTaskSessionReuse: () => ({ enabled: false, revision: 0 }),
  writeTaskSessionReuse: () => ({})
}))
vi.mock('@data/services/AgentWorkspaceService', () => ({ agentWorkspaceService: {} }))
vi.mock('@data/services/JobScheduleService', () => ({
  jobScheduleService: {
    listAll: () => mocks.schedules
  }
}))
vi.mock('@data/services/JobService', () => ({ jobService: {} }))
vi.mock('../agentTaskJobHandler', () => ({ agentTaskJobHandler: {} }))
vi.mock('../heartbeatSchedule', () => ({
  isReservedHeartbeatScheduleName: () => false,
  pauseHeartbeatSchedule: vi.fn(),
  reapOrphanedScheduleRows: mocks.reapOrphanedScheduleRows,
  repairHeartbeatSchedules: vi.fn(),
  syncHeartbeatSchedule: vi.fn()
}))

import { AgentJobsService } from '../AgentJobsService'

function schedule(id: string, agentId: string) {
  return {
    id,
    jobInputTemplate: { agentId, prompt: 'scheduled task' }
  }
}

describe('AgentJobsService startup recovery ordering', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    mocks.agentCreated.mockClear()
    mocks.agentUpdated.mockClear()
    mocks.pause.mockClear()
    mocks.reapOrphanedScheduleRows.mockReset()
    mocks.registerHandler.mockClear()
    mocks.schedules = []
  })

  it('does not finish readiness until orphan cleanup settles', async () => {
    mocks.schedules = [schedule('orphan', 'agent-missing')]

    let releaseCleanup!: () => void
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })
    mocks.reapOrphanedScheduleRows.mockReturnValue(cleanup)

    const service = new AgentJobsService()
    let ready = false
    const init = service._doInit().then(() => {
      ready = true
    })

    await vi.waitFor(() => expect(mocks.reapOrphanedScheduleRows).toHaveBeenCalledOnce())
    expect(ready).toBe(false)
    expect(mocks.reapOrphanedScheduleRows).toHaveBeenCalledWith(mocks.schedules, expect.any(AbortSignal), {
      throwOnFailure: true
    })

    releaseCleanup()
    await init
    expect(ready).toBe(true)
    expect(mocks.pause).not.toHaveBeenCalled()
  })

  it('keeps JobManager fail-closed with one hold after repeated startup failures', async () => {
    mocks.schedules = [schedule('orphan', 'agent-missing')]
    mocks.reapOrphanedScheduleRows.mockRejectedValue(new Error('cleanup failed'))
    const hold = { dispose: vi.fn() }
    mocks.pause.mockReturnValue(hold)

    const service = new AgentJobsService()
    await expect(service._doInit()).resolves.toBeUndefined()
    await (service as unknown as { onReady(): Promise<void> }).onReady()

    expect(mocks.pause).toHaveBeenCalledTimes(1)
    expect(mocks.pause).toHaveBeenCalledWith('agent-task startup reconciliation failed')
    await service._doStop()
    expect(hold.dispose).not.toHaveBeenCalled()
  })
})
