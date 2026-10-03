import '@data/services/AgentSessionMessageService'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable } from '@data/db/schemas/agentChannel'
import { jobScheduleTable } from '@data/db/schemas/job'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { AgentJobsService } from '@main/ai/agents/AgentJobsService'
import { JobManager } from '@main/core/job/JobManager'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'

import { CherryAutonomyTools } from '../cherryAutonomyTools'

vi.mock('@main/ai/agents/runAgentTask', () => ({ runAgentTask: vi.fn(async () => ({})) }))

const AGENT_ID = 'cron-owner'
const OTHER_AGENT_ID = 'cron-other'
const CHANNEL_ID = 'cron-channel'
const FUTURE_TIME = Date.now() + 3_600_000

function createTools(agentId = AGENT_ID, channelIds: string[] = []) {
  return new CherryAutonomyTools({
    agentId,
    sessionId: 'cron-session',
    workspaceSource: { type: 'system' },
    workspacePath: '/tmp/cherry-cron-test',
    trustedNotifyChannels: channelIds.map((id) => ({ id, type: 'telegram' })),
    getKnowledgeBaseIds: () => []
  })
}

function resultText(result: Awaited<ReturnType<CherryAutonomyTools['call']>>): string {
  return result.content.flatMap((item) => (item.type === 'text' ? [item.text] : [])).join('\n')
}

describe('cron tool persisted task contract', () => {
  const dbh = setupTestDatabase()
  let scheduler: SchedulerService
  let jobs: JobManager
  let tasks: AgentJobsService

  beforeEach(async () => {
    BaseService.resetInstances()
    scheduler = new SchedulerService()
    jobs = new JobManager()
    tasks = new AgentJobsService()
    const originalGet = vi.mocked(application.get).getMockImplementation()!
    vi.mocked(application.get).mockImplementation((name) => {
      if (name === 'SchedulerService') return scheduler
      if (name === 'JobManager') return jobs
      if (name === 'AgentJobsService') return tasks
      return originalGet(name)
    })
    await scheduler._doInit()
    await jobs._doInit()
    jobs.registerHandler('agent.task', { recovery: 'abandon', execute: async () => ({}) })
    dbh.db
      .insert(agentTable)
      .values(
        [AGENT_ID, OTHER_AGENT_ID].map((id) => ({
          id,
          type: 'claude-code' as const,
          name: id,
          instructions: '',
          orderKey: id
        }))
      )
      .run()
    dbh.db
      .insert(agentChannelTable)
      .values({
        id: CHANNEL_ID,
        type: 'telegram',
        name: 'Reports',
        agentId: AGENT_ID,
        workspace: { type: 'system' },
        config: {}
      })
      .run()
  })

  afterEach(async () => {
    await jobs._doStop()
    await scheduler._doStop()
    BaseService.resetInstances()
  })

  function createTask(overrides = {}) {
    return tasks.createTask(AGENT_ID, {
      name: 'daily-report',
      prompt: 'Old instructions',
      trigger: { kind: 'interval', ms: 3_600_000 },
      workspace: { type: 'system' },
      timeoutMinutes: 10,
      reuseSession: true,
      channelIds: [CHANNEL_ID],
      ...overrides
    })
  }

  it('advertises update and reuse_session to the Agent', () => {
    const schema = createTools()
      .tools()
      .find((tool) => tool.name === 'cron')!.inputSchema
    expect(schema.properties?.action).toMatchObject({ enum: ['add', 'update', 'list', 'remove'] })
    expect(schema.properties?.reuse_session).toMatchObject({ type: 'boolean' })
  })

  it('updates the prompt in place while preserving the schedule, workspace, timeout, reuse and recipients', async () => {
    const workspace = agentWorkspaceService.findOrCreateByPath('/tmp/cherry-cron-saved-workspace')
    const source = { type: 'user' as const, workspaceId: workspace.id }
    const task = createTask({ workspace: source })
    const session = agentSessionService.create({ agentId: AGENT_ID, name: 'Recurring report', workspace: source })
    expect(
      tasks.bindTaskSessionReuse({
        scheduleId: task.id,
        sessionId: session.id,
        agentId: AGENT_ID,
        workspace: source,
        reuseRevision: 0
      })
    ).toBe(true)
    const before = jobScheduleService.getById(task.id)!
    const result = await createTools().call('cron', { action: 'update', id: task.id, message: 'New instructions' })
    expect(result.isError, resultText(result)).not.toBe(true)
    expect(resultText(result)).toContain('Job updated:')
    expect(agentTaskService.getTask(AGENT_ID, task.id)).toMatchObject({
      id: task.id,
      name: task.name,
      prompt: 'New instructions',
      trigger: task.trigger,
      workspace: source,
      timeoutMinutes: 10,
      reuseSession: true,
      reuseSessionId: session.id,
      channelIds: [CHANNEL_ID]
    })
    expect(jobScheduleService.getById(task.id)).toMatchObject({
      id: task.id,
      trigger: before.trigger,
      nextRun: before.nextRun,
      metadata: before.metadata
    })
    expect(agentTaskService.listTasks(AGENT_ID).tasks).toHaveLength(1)
  })

  it.each([true, false, undefined])('persists reuse_session=%s on add', async (reuseSession) => {
    const result = await createTools().call('cron', {
      action: 'add',
      name: 'reuse-option',
      message: 'Run report',
      every: '1h',
      reuse_session: reuseSession
    })
    expect(result.isError, resultText(result)).not.toBe(true)
    expect(agentTaskService.listTasks(AGENT_ID).tasks).toMatchObject([
      { name: 'reuse-option', prompt: 'Run report', reuseSession: reuseSession === true }
    ])
  })

  it('can toggle reuse without replacing the task or changing its prompt', async () => {
    const task = createTask()
    for (const enabled of [false, true]) {
      const result = await createTools().call('cron', { action: 'update', id: task.id, reuse_session: enabled })
      expect(result.isError, resultText(result)).not.toBe(true)
      expect(agentTaskService.getTask(AGENT_ID, task.id)).toMatchObject({
        id: task.id,
        prompt: task.prompt,
        reuseSession: enabled
      })
    }
  })

  it.each([
    { cron: '0 9 * * 1-5', trigger: { kind: 'cron', expr: '0 9 * * 1-5' } },
    { every: '1h30m', trigger: { kind: 'interval', ms: 5_400_000 } },
    { at: new Date(FUTURE_TIME).toISOString(), trigger: { kind: 'once', at: FUTURE_TIME } }
  ])('updates a schedule using $trigger.kind', async ({ trigger, ...schedule }) => {
    const task = createTask()
    const result = await createTools().call('cron', {
      action: 'update',
      id: task.id,
      name: 'renamed',
      timeout_minutes: 20,
      ...schedule
    })
    expect(result.isError, resultText(result)).not.toBe(true)
    expect(agentTaskService.getTask(AGENT_ID, task.id)).toMatchObject({ name: 'renamed', trigger, timeoutMinutes: 20 })
  })

  it('clears notification subscriptions only when an empty array is supplied', async () => {
    const task = createTask()
    const tools = createTools(AGENT_ID, [CHANNEL_ID])
    const result = await tools.call('cron', { action: 'update', id: task.id, channel_ids: [] })
    expect(result.isError, resultText(result)).not.toBe(true)
    expect(agentTaskService.getTask(AGENT_ID, task.id)?.channelIds).toEqual([])
    const restored = await tools.call('cron', { action: 'update', id: task.id, channel_ids: [CHANNEL_ID] })
    expect(restored.isError).not.toBe(true)
    expect(agentTaskService.getTask(AGENT_ID, task.id)?.channelIds).toEqual([CHANNEL_ID])
  })

  it('supports an explicit unlimited timeout', async () => {
    const task = createTask()
    const result = await createTools().call('cron', { action: 'update', id: task.id, timeout_minutes: null })
    expect(result.isError, resultText(result)).not.toBe(true)
    expect(agentTaskService.getTask(AGENT_ID, task.id)?.timeoutMinutes).toBe(0)
  })

  it('rejects foreign task ids without changing the task', async () => {
    const task = createTask()
    const result = await createTools(OTHER_AGENT_ID).call('cron', {
      action: 'update',
      id: task.id,
      message: 'Hijacked'
    })
    expect(result.isError).toBe(true)
    expect(resultText(result)).toContain('not found')
    expect(agentTaskService.getTask(AGENT_ID, task.id)).toEqual(task)
  })

  it.each([
    { id: undefined, message: 'Changed' },
    { id: 'missing-task', message: 'Changed' },
    { cron: '* * * * *', every: '1h' },
    { at: 'invalid-date' },
    { reuse_session: 'false' },
    { message: '' },
    { timeout_minutes: -1 },
    { channel_ids: null },
    { channel_ids: [CHANNEL_ID] }
  ])('rejects invalid or unauthorized updates atomically: %j', async (patch) => {
    const task = createTask()
    const before = jobScheduleService.getById(task.id)
    const result = await createTools().call('cron', { action: 'update', id: task.id, ...patch })
    expect(result.isError).toBe(true)
    expect(jobScheduleService.getById(task.id)).toEqual(before)
    expect(agentTaskService.getTask(AGENT_ID, task.id)?.channelIds).toEqual([CHANNEL_ID])
  })

  it.each(['add', 'update'])(
    'explains a hidden disabled task name conflict on %s and preserves both tasks',
    async (action) => {
      const occupied = createTask()
      await tasks.pauseTask(AGENT_ID, occupied.id)
      const ownTask = tasks.createTask(OTHER_AGENT_ID, {
        name: 'other-report',
        prompt: 'Keep this',
        trigger: { kind: 'interval', ms: 3_600_000 },
        workspace: { type: 'system' }
      })
      const tools = createTools(OTHER_AGENT_ID)
      const listed = resultText(await tools.call('cron', { action: 'list' }))
      expect(listed).not.toContain(occupied.id)
      const result = await tools.call('cron', {
        action,
        id: ownTask.id,
        name: occupied.name,
        message: 'Changed',
        every: '1h'
      })
      expect(result.isError).toBe(true)
      for (const hint of [
        'JOB_SCHEDULE_NAME_CONFLICT',
        'all Agents',
        'disabled',
        'update',
        'different name',
        'Settings'
      ]) {
        expect(resultText(result)).toContain(hint)
      }
      expect(agentTaskService.getTask(OTHER_AGENT_ID, ownTask.id)).toEqual(ownTask)
      expect(agentTaskService.getTask(AGENT_ID, occupied.id)?.prompt).toBe(occupied.prompt)
      expect(dbh.db.select().from(jobScheduleTable).all()).toHaveLength(2)
    }
  )
})
