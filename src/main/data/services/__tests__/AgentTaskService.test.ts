/**
 * Thin-facade behaviour tests for AgentTaskService.
 *
 * These do NOT spin up the real JobManager — that's exercised by the
 * JobManager integration suite. Here we just verify the facade is wiring
 * the right calls with the right shapes.
 */

import type { CreateTaskDto } from '@shared/data/api/schemas/agents'
import type { JobScheduleSnapshot, JobSnapshot } from '@shared/data/api/schemas/jobs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

const dbDeleteMock = vi.fn()
const dbInsertMock = vi.fn()
const dbSelectMock = vi.fn()
const { replaceTaskSubscriptionsMock } = vi.hoisted(() => ({
  replaceTaskSubscriptionsMock: vi.fn()
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: { getSubscribedChannels: vi.fn(), replaceTaskSubscriptions: replaceTaskSubscriptionsMock }
}))
vi.mock('@data/services/JobScheduleService', () => ({
  jobScheduleService: { getById: vi.fn(), listAll: vi.fn() }
}))
vi.mock('@data/services/JobService', () => ({
  jobService: { list: vi.fn() }
}))

import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'

import { agentTaskService } from '../AgentTaskService'

const AGENT_ID = 'agent-a1'
const TASK_ID = 'sched-1'

const validTrigger = { kind: 'interval' as const, ms: 60_000 }
const validDto: CreateTaskDto = {
  name: 'daily-report',
  prompt: 'Summarise yesterday',
  trigger: validTrigger,
  timeoutMinutes: 5
}

function makeSnapshot(overrides: Partial<JobScheduleSnapshot> = {}): JobScheduleSnapshot {
  return {
    id: TASK_ID,
    type: 'agent.task',
    name: 'daily-report',
    trigger: validTrigger,
    jobInputTemplate: { agentId: AGENT_ID, prompt: 'Summarise yesterday', timeoutMinutes: 5 },
    enabled: true,
    nextRun: '2026-05-20T01:00:00.000Z',
    lastRun: null,
    catchUpPolicy: { kind: 'skip-missed' },
    metadata: {},
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
    ...overrides
  }
}

function makeJobSnapshot(overrides: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    id: 'job-1',
    type: 'agent.task',
    status: 'completed',
    priority: 0,
    queue: `agent:${AGENT_ID}`,
    idempotencyKey: null,
    scheduleId: TASK_ID,
    scheduledAt: '2026-05-20T00:00:00.000Z',
    startedAt: '2026-05-20T00:00:01.000Z',
    finishedAt: '2026-05-20T00:00:05.000Z',
    attempt: 0,
    maxAttempts: 1,
    input: {},
    output: { sessionId: 'sess-1', result: 'ok' },
    error: null,
    parentId: null,
    cancelRequested: false,
    metadata: {},
    timeoutMs: null,
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:05.000Z',
    ...overrides
  }
}

const registerJobScheduleMock = vi.fn()
const updateJobScheduleMock = vi.fn()
const unregisterJobScheduleByIdMock = vi.fn()

function setupApplicationMocks(opts: { configuration?: Record<string, unknown> | null } = {}) {
  const { configuration = { soul_enabled: true } } = opts
  const fakeQueryChain = {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(configuration === null ? [] : [{ configuration }])
      })
    })
  }
  dbSelectMock.mockReturnValue(fakeQueryChain)
  dbInsertMock.mockReturnValue({
    values: () => ({ onConflictDoNothing: () => Promise.resolve() })
  })
  dbDeleteMock.mockReturnValue({ where: () => Promise.resolve() })

  vi.mocked(application.get).mockImplementation((name: string) => {
    if (name === 'DbService') {
      return {
        getDb: () => ({
          select: dbSelectMock,
          insert: dbInsertMock,
          delete: dbDeleteMock
        })
      } as never
    }
    if (name === 'JobManager') {
      return {
        registerJobSchedule: registerJobScheduleMock,
        updateJobSchedule: updateJobScheduleMock,
        unregisterJobScheduleById: unregisterJobScheduleByIdMock
      } as never
    }
    throw new Error(`Unexpected application.get('${name}')`)
  })
}

describe('AgentTaskService (thin facade)', () => {
  beforeEach(() => {
    registerJobScheduleMock.mockReset()
    updateJobScheduleMock.mockReset()
    unregisterJobScheduleByIdMock.mockReset()
    dbSelectMock.mockReset()
    dbInsertMock.mockReset()
    dbDeleteMock.mockReset()
    vi.mocked(agentChannelService.getSubscribedChannels).mockReset()
    vi.mocked(agentChannelService.getSubscribedChannels).mockResolvedValue([])
    replaceTaskSubscriptionsMock.mockReset()
    vi.mocked(jobScheduleService.getById).mockReset()
    vi.mocked(jobScheduleService.listAll).mockReset()
    vi.mocked(jobService.list).mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('createTask', () => {
    it('registers a schedule with agent.task type when the agent is autonomous', async () => {
      setupApplicationMocks()
      registerJobScheduleMock.mockResolvedValueOnce({ id: TASK_ID })
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSnapshot())

      const result = await agentTaskService.createTask(AGENT_ID, validDto)

      expect(registerJobScheduleMock).toHaveBeenCalledWith({
        type: 'agent.task',
        name: validDto.name,
        trigger: validTrigger,
        jobInputTemplate: { agentId: AGENT_ID, prompt: validDto.prompt, timeoutMinutes: 5 },
        catchUpPolicy: { kind: 'skip-missed' }
      })
      expect(result).toMatchObject({ id: TASK_ID, agentId: AGENT_ID, name: validDto.name, enabled: true })
    })

    it('throws notFound when the agent does not exist', async () => {
      setupApplicationMocks({ configuration: null })

      await expect(agentTaskService.createTask(AGENT_ID, validDto)).rejects.toMatchObject({
        message: expect.stringContaining('Agent')
      })
      expect(registerJobScheduleMock).not.toHaveBeenCalled()
    })

    it('throws invalidOperation when the agent is not autonomous', async () => {
      setupApplicationMocks({ configuration: { soul_enabled: false } })

      await expect(agentTaskService.createTask(AGENT_ID, validDto)).rejects.toMatchObject({
        message: expect.stringContaining('Soul Mode')
      })
      expect(registerJobScheduleMock).not.toHaveBeenCalled()
    })

    it('accepts bypassPermissions as a valid autonomous configuration', async () => {
      setupApplicationMocks({ configuration: { permission_mode: 'bypassPermissions' } })
      registerJobScheduleMock.mockResolvedValueOnce({ id: TASK_ID })
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSnapshot())

      await expect(agentTaskService.createTask(AGENT_ID, validDto)).resolves.toMatchObject({ id: TASK_ID })
    })

    it('delegates task channel subscriptions to AgentChannelService', async () => {
      setupApplicationMocks()
      registerJobScheduleMock.mockResolvedValueOnce({ id: TASK_ID })
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSnapshot())

      await agentTaskService.createTask(AGENT_ID, { ...validDto, channelIds: ['channel-1', 'channel-2'] })

      expect(replaceTaskSubscriptionsMock).toHaveBeenCalledWith(TASK_ID, ['channel-1', 'channel-2'])
      expect(dbInsertMock).not.toHaveBeenCalled()
    })

    it('rolls back the registered schedule when channel subscription replacement fails', async () => {
      setupApplicationMocks()
      const error = new Error('bad channel')
      registerJobScheduleMock.mockResolvedValueOnce({ id: TASK_ID })
      replaceTaskSubscriptionsMock.mockRejectedValueOnce(error)
      unregisterJobScheduleByIdMock.mockResolvedValueOnce(true)

      await expect(
        agentTaskService.createTask(AGENT_ID, { ...validDto, channelIds: ['missing-channel'] })
      ).rejects.toThrow(error)

      expect(unregisterJobScheduleByIdMock).toHaveBeenCalledWith(TASK_ID)
      expect(vi.mocked(jobScheduleService.getById)).not.toHaveBeenCalled()
    })
  })

  describe('getTask', () => {
    it('returns the entity when agentId matches the snapshot template', async () => {
      setupApplicationMocks()
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSnapshot())

      const result = await agentTaskService.getTask(AGENT_ID, TASK_ID)

      expect(result).toMatchObject({ id: TASK_ID, agentId: AGENT_ID, enabled: true, status: 'active' })
    })

    it('returns null when agentId does not match', async () => {
      setupApplicationMocks()
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(
        makeSnapshot({ jobInputTemplate: { agentId: 'other-agent', prompt: 'x', timeoutMinutes: 2 } })
      )

      const result = await agentTaskService.getTask(AGENT_ID, TASK_ID)
      expect(result).toBeNull()
    })

    it('returns null when the schedule does not exist', async () => {
      setupApplicationMocks()
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(null)

      const result = await agentTaskService.getTask(AGENT_ID, TASK_ID)
      expect(result).toBeNull()
    })

    it('derives status=paused when the schedule is disabled', async () => {
      setupApplicationMocks()
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSnapshot({ enabled: false }))

      const result = await agentTaskService.getTask(AGENT_ID, TASK_ID)
      expect(result).toMatchObject({ enabled: false, status: 'paused' })
    })

    it('derives status=completed for an exhausted once trigger', async () => {
      setupApplicationMocks()
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(
        makeSnapshot({
          trigger: { kind: 'once', at: 0 },
          enabled: true,
          nextRun: null,
          lastRun: '2026-05-20T00:00:01.000Z'
        })
      )

      const result = await agentTaskService.getTask(AGENT_ID, TASK_ID)
      expect(result).toMatchObject({ status: 'completed' })
    })
  })

  describe('listTasks', () => {
    it('filters by agentId and excludes heartbeat tasks by default', async () => {
      setupApplicationMocks()
      vi.mocked(jobScheduleService.listAll).mockResolvedValueOnce([
        makeSnapshot({ id: 's1', name: 'a' }),
        makeSnapshot({
          id: 's2',
          name: 'b',
          jobInputTemplate: { agentId: 'other', prompt: 'x', timeoutMinutes: 2 }
        }),
        makeSnapshot({ id: 's3', name: 'heartbeat' })
      ])

      const result = await agentTaskService.listTasks(AGENT_ID)

      expect(result.tasks).toHaveLength(1)
      expect(result.total).toBe(1)
      expect(result.tasks[0].id).toBe('s1')
    })

    it('returns heartbeat tasks when includeHeartbeat=true', async () => {
      setupApplicationMocks()
      vi.mocked(jobScheduleService.listAll).mockResolvedValueOnce([
        makeSnapshot({ id: 's1', name: 'a' }),
        makeSnapshot({ id: 's3', name: 'heartbeat' })
      ])

      const result = await agentTaskService.listTasks(AGENT_ID, { includeHeartbeat: true })

      expect(result.tasks).toHaveLength(2)
    })
  })

  describe('updateTask', () => {
    it('forwards trigger and enabled patches and rebuilds jobInputTemplate when prompt changed', async () => {
      setupApplicationMocks()
      vi.mocked(jobScheduleService.getById)
        .mockResolvedValueOnce(makeSnapshot()) // getTask lookup
        .mockResolvedValueOnce(makeSnapshot()) // mid-update re-read
        .mockResolvedValueOnce(makeSnapshot({ name: 'new-name' })) // post-update refresh
      updateJobScheduleMock.mockResolvedValueOnce(makeSnapshot({ name: 'new-name' }))

      await agentTaskService.updateTask(AGENT_ID, TASK_ID, {
        name: 'new-name',
        prompt: 'new prompt',
        enabled: false
      })

      expect(updateJobScheduleMock).toHaveBeenCalledWith(
        TASK_ID,
        expect.objectContaining({
          name: 'new-name',
          enabled: false,
          jobInputTemplate: { agentId: AGENT_ID, prompt: 'new prompt', timeoutMinutes: 5 }
        })
      )
    })

    it('does not touch jobInputTemplate when only enabled changed', async () => {
      setupApplicationMocks()
      vi.mocked(jobScheduleService.getById)
        .mockResolvedValueOnce(makeSnapshot())
        .mockResolvedValueOnce(makeSnapshot())
        .mockResolvedValueOnce(makeSnapshot({ enabled: false }))
      updateJobScheduleMock.mockResolvedValueOnce(makeSnapshot({ enabled: false }))

      await agentTaskService.updateTask(AGENT_ID, TASK_ID, { enabled: false })

      expect(updateJobScheduleMock).toHaveBeenCalledTimes(1)
      const patch = updateJobScheduleMock.mock.calls[0][1]
      expect(patch).not.toHaveProperty('jobInputTemplate')
    })

    it('delegates channel replacement when channelIds are patched', async () => {
      setupApplicationMocks()
      vi.mocked(jobScheduleService.getById)
        .mockResolvedValueOnce(makeSnapshot())
        .mockResolvedValueOnce(makeSnapshot())
        .mockResolvedValueOnce(makeSnapshot())
      updateJobScheduleMock.mockResolvedValueOnce(makeSnapshot())

      await agentTaskService.updateTask(AGENT_ID, TASK_ID, { channelIds: ['channel-3'] })

      expect(replaceTaskSubscriptionsMock).toHaveBeenCalledWith(TASK_ID, ['channel-3'])
      expect(dbDeleteMock).not.toHaveBeenCalled()
    })

    it('returns null when the task does not exist', async () => {
      setupApplicationMocks()
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(null)

      const result = await agentTaskService.updateTask(AGENT_ID, TASK_ID, { enabled: false })
      expect(result).toBeNull()
      expect(updateJobScheduleMock).not.toHaveBeenCalled()
    })
  })

  describe('deleteTask', () => {
    it('delegates to unregisterJobScheduleById when the task exists', async () => {
      setupApplicationMocks()
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSnapshot())
      unregisterJobScheduleByIdMock.mockResolvedValueOnce(true)

      const result = await agentTaskService.deleteTask(AGENT_ID, TASK_ID)

      expect(unregisterJobScheduleByIdMock).toHaveBeenCalledWith(TASK_ID)
      expect(result).toBe(true)
    })

    it('returns false (without deleting) when the task does not belong to the agent', async () => {
      setupApplicationMocks()
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(
        makeSnapshot({ jobInputTemplate: { agentId: 'other', prompt: 'x', timeoutMinutes: 2 } })
      )

      const result = await agentTaskService.deleteTask(AGENT_ID, TASK_ID)
      expect(result).toBe(false)
      expect(unregisterJobScheduleByIdMock).not.toHaveBeenCalled()
    })
  })

  describe('getTaskLogs', () => {
    it('maps jobs to TaskRunLogEntity with the new field names', async () => {
      setupApplicationMocks()
      vi.mocked(jobService.list).mockResolvedValueOnce([
        makeJobSnapshot({ id: 'j1', status: 'completed' }),
        makeJobSnapshot({ id: 'j2', status: 'pending', startedAt: null, finishedAt: null }),
        makeJobSnapshot({ id: 'j3', status: 'failed', error: { code: 'X', message: 'boom', retryable: false } })
      ])

      const result = await agentTaskService.getTaskLogs(TASK_ID)

      expect(result.total).toBe(3)
      expect(result.logs).toEqual([
        expect.objectContaining({
          id: 'j1',
          scheduleId: TASK_ID,
          status: 'completed',
          sessionId: 'sess-1'
        }),
        expect.objectContaining({ id: 'j2', status: 'running' }),
        expect.objectContaining({ id: 'j3', status: 'failed', error: 'boom' })
      ])
      expect(result.logs[0]).not.toHaveProperty('taskId')
      expect(result.logs[0]).not.toHaveProperty('runAt')
      expect(result.logs[0]).toHaveProperty('startedAt')
    })
  })
})
