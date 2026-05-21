/**
 * Behaviour tests for AgentTaskService.
 *
 * DbService is wired to a real `setupTestDatabase()`-backed SQLite instance so
 * `assertAutonomous` reads the real `agent` table and `createTask` exercises
 * real `agent_channel_task` writes (including FK enforcement). JobManager and
 * the higher-level Job/Schedule services stay mocked — the full JobManager is
 * covered by its own integration suite.
 */

import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable, agentChannelTaskTable } from '@data/db/schemas/agentChannel'
import { jobScheduleTable } from '@data/db/schemas/job'
import type { CreateTaskDto } from '@shared/data/api/schemas/agents'
import type { JobScheduleSnapshot, JobSnapshot, Trigger } from '@shared/data/api/schemas/jobs'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: { getSubscribedChannels: vi.fn() }
}))
vi.mock('@data/services/JobScheduleService', () => ({
  jobScheduleService: { getById: vi.fn(), listAll: vi.fn() }
}))
vi.mock('@data/services/JobService', () => ({
  jobService: { list: vi.fn(), count: vi.fn() }
}))

import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'

import { agentTaskService } from '../AgentTaskService'

const AGENT_ID = 'agent-a1'
const TASK_ID = 'sched-1'
const CHANNEL_ID = 'channel-1'

const validTrigger: Trigger = { kind: 'interval', ms: 60_000 }
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

describe('AgentTaskService', () => {
  const dbh = setupTestDatabase()

  const registerJobScheduleMock = vi.fn()
  const updateJobScheduleMock = vi.fn()
  const unregisterJobScheduleByIdMock = vi.fn()

  /** Seed an `agent` row with optional configuration overrides. */
  async function seedAgent(configuration: Record<string, unknown> | null = { soul_enabled: true }): Promise<void> {
    await dbh.db.insert(agentTable).values({
      id: AGENT_ID,
      type: 'claude-code',
      name: 'Test Agent',
      instructions: 'h',
      model: 'sonnet',
      sortOrder: 0,
      configuration: configuration ?? undefined
    })
  }

  /** Seed an `agent_channel` row so FK from `agent_channel_task.channel_id` resolves. */
  async function seedChannel(): Promise<void> {
    await dbh.db.insert(agentChannelTable).values({
      id: CHANNEL_ID,
      type: 'telegram',
      name: 'TG',
      agentId: AGENT_ID,
      config: { bot_token: 'x', allowed_chat_ids: [] },
      isActive: true
    })
  }

  /** Seed a `job_schedule` row so FK from `agent_channel_task.task_id` resolves. */
  async function seedSchedule(id: string = TASK_ID, name: string = 'daily-report'): Promise<void> {
    await dbh.db.insert(jobScheduleTable).values({
      id,
      type: 'agent.task',
      name,
      trigger: validTrigger,
      jobInputTemplate: { agentId: AGENT_ID, prompt: 'p', timeoutMinutes: 5 },
      enabled: true,
      catchUpPolicy: { kind: 'skip-missed' },
      metadata: {}
    })
  }

  beforeEach(() => {
    registerJobScheduleMock.mockReset()
    updateJobScheduleMock.mockReset()
    unregisterJobScheduleByIdMock.mockReset()
    vi.mocked(agentChannelService.getSubscribedChannels).mockReset()
    vi.mocked(agentChannelService.getSubscribedChannels).mockResolvedValue([])
    vi.mocked(jobScheduleService.getById).mockReset()
    vi.mocked(jobScheduleService.listAll).mockReset()
    vi.mocked(jobService.list).mockReset()
    vi.mocked(jobService.count).mockReset()

    vi.mocked(application.get).mockImplementation((name: string) => {
      if (name === 'DbService') {
        return { getDb: () => dbh.db } as never
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
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('createTask', () => {
    it('registers a schedule with agent.task type when the agent is autonomous', async () => {
      await seedAgent({ soul_enabled: true })
      registerJobScheduleMock.mockImplementationOnce(async () => {
        await seedSchedule()
        return { id: TASK_ID }
      })
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
      // No seed — the SELECT against `agent` returns zero rows.
      await expect(agentTaskService.createTask(AGENT_ID, validDto)).rejects.toMatchObject({
        message: expect.stringContaining('Agent')
      })
      expect(registerJobScheduleMock).not.toHaveBeenCalled()
    })

    it('throws invalidOperation when the agent is not autonomous', async () => {
      await seedAgent({ soul_enabled: false })

      await expect(agentTaskService.createTask(AGENT_ID, validDto)).rejects.toMatchObject({
        message: expect.stringContaining('Soul Mode')
      })
      expect(registerJobScheduleMock).not.toHaveBeenCalled()
    })

    it('accepts bypassPermissions as a valid autonomous configuration', async () => {
      await seedAgent({ permission_mode: 'bypassPermissions' })
      registerJobScheduleMock.mockImplementationOnce(async () => {
        await seedSchedule()
        return { id: TASK_ID }
      })
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSnapshot())

      await expect(agentTaskService.createTask(AGENT_ID, validDto)).resolves.toMatchObject({ id: TASK_ID })
    })

    it('inserts agent_channel_task rows when channelIds are provided', async () => {
      await seedAgent()
      await seedChannel()
      registerJobScheduleMock.mockImplementationOnce(async () => {
        await seedSchedule()
        return { id: TASK_ID }
      })
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSnapshot())

      await agentTaskService.createTask(AGENT_ID, { ...validDto, channelIds: [CHANNEL_ID] })

      const links = await dbh.db
        .select({ taskId: agentChannelTaskTable.taskId, channelId: agentChannelTaskTable.channelId })
        .from(agentChannelTaskTable)
        .where(eq(agentChannelTaskTable.taskId, TASK_ID))
      expect(links).toEqual([{ taskId: TASK_ID, channelId: CHANNEL_ID }])
    })

    it('rolls back the schedule when channel insert fails (FK violation)', async () => {
      await seedAgent()
      // Do NOT seed the channel — the channel_id FK on agent_channel_task will fail.
      registerJobScheduleMock.mockImplementationOnce(async () => {
        await seedSchedule()
        return { id: TASK_ID }
      })
      unregisterJobScheduleByIdMock.mockResolvedValueOnce(true)

      await expect(
        agentTaskService.createTask(AGENT_ID, { ...validDto, channelIds: ['no-such-channel'] })
      ).rejects.toThrow()

      expect(unregisterJobScheduleByIdMock).toHaveBeenCalledWith(TASK_ID)
    })
  })

  describe('getTask', () => {
    it('returns the entity when agentId matches the snapshot template', async () => {
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSnapshot())

      const result = await agentTaskService.getTask(AGENT_ID, TASK_ID)

      expect(result).toMatchObject({ id: TASK_ID, agentId: AGENT_ID, enabled: true, status: 'active' })
    })

    it('returns null when agentId does not match', async () => {
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(
        makeSnapshot({ jobInputTemplate: { agentId: 'other-agent', prompt: 'x', timeoutMinutes: 2 } })
      )

      const result = await agentTaskService.getTask(AGENT_ID, TASK_ID)
      expect(result).toBeNull()
    })

    it('returns null when the schedule does not exist', async () => {
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(null)

      const result = await agentTaskService.getTask(AGENT_ID, TASK_ID)
      expect(result).toBeNull()
    })

    it('derives status=paused when the schedule is disabled', async () => {
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSnapshot({ enabled: false }))

      const result = await agentTaskService.getTask(AGENT_ID, TASK_ID)
      expect(result).toMatchObject({ enabled: false, status: 'paused' })
    })

    it('derives status=completed for an exhausted once trigger', async () => {
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

    it('returns null when the task does not exist', async () => {
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(null)

      const result = await agentTaskService.updateTask(AGENT_ID, TASK_ID, { enabled: false })
      expect(result).toBeNull()
      expect(updateJobScheduleMock).not.toHaveBeenCalled()
    })
  })

  describe('deleteTask', () => {
    it('delegates to unregisterJobScheduleById when the task exists', async () => {
      vi.mocked(jobScheduleService.getById).mockResolvedValueOnce(makeSnapshot())
      unregisterJobScheduleByIdMock.mockResolvedValueOnce(true)

      const result = await agentTaskService.deleteTask(AGENT_ID, TASK_ID)

      expect(unregisterJobScheduleByIdMock).toHaveBeenCalledWith(TASK_ID)
      expect(result).toBe(true)
    })

    it('returns false (without deleting) when the task does not belong to the agent', async () => {
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
      vi.mocked(jobService.list).mockResolvedValueOnce([
        makeJobSnapshot({ id: 'j1', status: 'completed' }),
        makeJobSnapshot({ id: 'j2', status: 'pending', startedAt: null, finishedAt: null }),
        makeJobSnapshot({ id: 'j3', status: 'failed', error: { code: 'X', message: 'boom', retryable: false } })
      ])
      vi.mocked(jobService.count).mockResolvedValueOnce(3)

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

    it('passes limit/offset to jobService.list and reports the full count separately', async () => {
      vi.mocked(jobService.list).mockResolvedValueOnce([
        makeJobSnapshot({ id: 'j5', status: 'completed' }),
        makeJobSnapshot({ id: 'j6', status: 'completed' })
      ])
      vi.mocked(jobService.count).mockResolvedValueOnce(42)

      const result = await agentTaskService.getTaskLogs(TASK_ID, { limit: 2, offset: 10 })

      expect(jobService.list).toHaveBeenCalledWith({ scheduleId: TASK_ID, limit: 2, offset: 10 })
      expect(jobService.count).toHaveBeenCalledWith({ scheduleId: TASK_ID })
      expect(result.logs).toHaveLength(2)
      expect(result.total).toBe(42)
    })
  })
})
