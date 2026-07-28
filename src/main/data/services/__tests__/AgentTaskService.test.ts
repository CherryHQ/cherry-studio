/**
 * Read-side behaviour tests for AgentTaskService (list / get / logs and the
 * snapshot → entity mapping). Task mutations live on AgentJobsService and are
 * covered by its integration suite.
 */

import type { JobScheduleSnapshot, JobSnapshot } from '@shared/data/api/schemas/jobs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: {
    getSubscribedChannels: vi.fn()
  }
}))
vi.mock('@data/services/JobScheduleService', () => ({
  jobScheduleService: { getById: vi.fn(), listAll: vi.fn() }
}))
vi.mock('@data/services/JobService', () => ({
  jobService: { list: vi.fn() }
}))

import { agentChannelService } from '@data/services/AgentChannelService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'

import { agentTaskService } from '../AgentTaskService'

const AGENT_ID = 'agent-a1'
const TASK_ID = 'sched-1'

const validTrigger = { kind: 'interval' as const, ms: 60_000 }
const taskWorkspace = { type: 'user' as const, workspaceId: 'ws-task' }

function makeSnapshot(overrides: Partial<JobScheduleSnapshot> = {}): JobScheduleSnapshot {
  return {
    id: TASK_ID,
    type: 'agent.task',
    name: 'daily-report',
    trigger: validTrigger,
    jobInputTemplate: { agentId: AGENT_ID, prompt: 'Summarise yesterday', timeoutMinutes: 5, workspace: taskWorkspace },
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

describe('AgentTaskService (read side)', () => {
  beforeEach(() => {
    vi.mocked(agentChannelService.getSubscribedChannels).mockReset()
    vi.mocked(agentChannelService.getSubscribedChannels).mockReturnValue([])
    vi.mocked(jobScheduleService.getById).mockReset()
    vi.mocked(jobScheduleService.listAll).mockReset()
    vi.mocked(jobService.list).mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('getTask', () => {
    it('returns a task by id without requiring the owning agent id', () => {
      vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSnapshot())

      expect(agentTaskService.getTaskById(TASK_ID)).toMatchObject({ id: TASK_ID, agentId: AGENT_ID })
    })

    it('returns the entity when agentId matches the snapshot template', () => {
      vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSnapshot())

      const result = agentTaskService.getTask(AGENT_ID, TASK_ID)

      expect(result).toMatchObject({ id: TASK_ID, agentId: AGENT_ID, enabled: true, status: 'active' })
    })

    it('treats legacy task templates without workspace as system workspace tasks', () => {
      vi.mocked(jobScheduleService.getById).mockReturnValueOnce(
        makeSnapshot({
          jobInputTemplate: { agentId: AGENT_ID, prompt: 'legacy task', timeoutMinutes: 2 }
        })
      )

      const result = agentTaskService.getTask(AGENT_ID, TASK_ID)

      expect(result).toMatchObject({
        id: TASK_ID,
        agentId: AGENT_ID,
        workspace: { type: 'system' }
      })
    })

    it('returns null when agentId does not match', () => {
      vi.mocked(jobScheduleService.getById).mockReturnValueOnce(
        makeSnapshot({
          jobInputTemplate: { agentId: 'other-agent', prompt: 'x', timeoutMinutes: 2, workspace: taskWorkspace }
        })
      )

      expect(agentTaskService.getTask(AGENT_ID, TASK_ID)).toBeNull()
    })

    it('returns null when the schedule is not an agent.task', () => {
      vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSnapshot({ type: 'knowledge.ingest' }))

      expect(agentTaskService.getTask(AGENT_ID, TASK_ID)).toBeNull()
    })

    it('returns null when the schedule does not exist', () => {
      vi.mocked(jobScheduleService.getById).mockReturnValueOnce(null)

      expect(agentTaskService.getTask(AGENT_ID, TASK_ID)).toBeNull()
    })

    it('derives status=paused when the schedule is disabled', () => {
      vi.mocked(jobScheduleService.getById).mockReturnValueOnce(makeSnapshot({ enabled: false }))

      expect(agentTaskService.getTask(AGENT_ID, TASK_ID)).toMatchObject({ enabled: false, status: 'paused' })
    })

    it('derives status=completed for an exhausted once trigger', () => {
      vi.mocked(jobScheduleService.getById).mockReturnValueOnce(
        makeSnapshot({
          trigger: { kind: 'once', at: 0 },
          enabled: true,
          nextRun: null,
          lastRun: '2026-05-20T00:00:01.000Z'
        })
      )

      expect(agentTaskService.getTask(AGENT_ID, TASK_ID)).toMatchObject({ status: 'completed' })
    })
  })

  describe('listTasks', () => {
    it('filters by agentId and excludes heartbeat tasks by default', () => {
      vi.mocked(jobScheduleService.listAll).mockReturnValueOnce([
        makeSnapshot({ id: 's1', name: 'a' }),
        makeSnapshot({
          id: 's2',
          name: 'b',
          jobInputTemplate: { agentId: 'other', prompt: 'x', timeoutMinutes: 2, workspace: taskWorkspace }
        }),
        makeSnapshot({ id: 's3', name: 'heartbeat' })
      ])

      const result = agentTaskService.listTasks(AGENT_ID)

      expect(result.tasks).toHaveLength(1)
      expect(result.total).toBe(1)
      expect(result.tasks[0].id).toBe('s1')
    })

    it('returns heartbeat tasks when includeHeartbeat=true', () => {
      vi.mocked(jobScheduleService.listAll).mockReturnValueOnce([
        makeSnapshot({ id: 's1', name: 'a' }),
        makeSnapshot({ id: 's3', name: 'heartbeat' })
      ])

      const result = agentTaskService.listTasks(AGENT_ID, { includeHeartbeat: true })

      expect(result.tasks).toHaveLength(2)
    })
  })

  describe('listAllTasks', () => {
    it('returns tasks across agents, excludes heartbeat tasks, and paginates after sorting', () => {
      vi.mocked(jobScheduleService.listAll).mockReturnValueOnce([
        makeSnapshot({ id: 'older', createdAt: '2026-05-20T00:00:00.000Z' }),
        makeSnapshot({
          id: 'newer',
          createdAt: '2026-05-22T00:00:00.000Z',
          jobInputTemplate: { agentId: 'other', prompt: 'x', timeoutMinutes: 2, workspace: taskWorkspace }
        }),
        makeSnapshot({ id: 'heartbeat', name: 'heartbeat', createdAt: '2026-05-23T00:00:00.000Z' })
      ])

      const result = agentTaskService.listAllTasks({ limit: 1, offset: 0 })

      expect(result.total).toBe(2)
      expect(result.tasks).toHaveLength(1)
      expect(result.tasks[0]).toMatchObject({ id: 'newer', agentId: 'other' })
    })
  })

  describe('getTaskLogs', () => {
    it('maps jobs to TaskRunLogEntity with the new field names', () => {
      vi.mocked(jobService.list).mockReturnValueOnce([
        makeJobSnapshot({ id: 'j1', status: 'completed' }),
        makeJobSnapshot({ id: 'j2', status: 'pending', startedAt: null, finishedAt: null }),
        makeJobSnapshot({ id: 'j3', status: 'failed', error: { code: 'X', message: 'boom', retryable: false } })
      ])

      const result = agentTaskService.getTaskLogs(TASK_ID)

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
