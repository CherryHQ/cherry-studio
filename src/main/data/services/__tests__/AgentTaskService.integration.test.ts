import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { jobTable } from '@data/db/schemas/job'
import { agentTaskService } from '@data/services/AgentTaskService'
import { jobScheduleService } from '@data/services/JobScheduleService'

describe('AgentTaskService active-Agent read contract', () => {
  const dbh = setupTestDatabase()

  function seedAgent(id: string, deletedAt: number | null = null): void {
    dbh.db
      .insert(agentTable)
      .values({ id, type: 'claude-code', name: id, instructions: '', orderKey: id, deletedAt })
      .run()
  }

  function seedTask(name: string, agentId: string): string {
    return jobScheduleService.create({
      type: 'agent.task',
      name,
      trigger: { kind: 'interval', ms: 60_000 },
      jobInputTemplate: {
        agentId,
        prompt: `Prompt for ${name}`,
        timeoutMinutes: 2,
        workspace: { type: 'system' }
      },
      catchUpPolicy: { kind: 'skip-missed' }
    }).id
  }

  it('hides tasks owned by trashed or missing Agents from every normal read and shows them after restore', () => {
    seedAgent('agent-active')
    seedAgent('agent-trashed', Date.now())
    const activeTaskId = seedTask('task-active', 'agent-active')
    const trashedTaskId = seedTask('task-trashed', 'agent-trashed')
    const missingTaskId = seedTask('task-missing', 'agent-missing')

    expect(agentTaskService.listAllTasks().tasks.map((task) => task.id)).toEqual([activeTaskId])
    expect(agentTaskService.listTasks('agent-trashed')).toEqual({ tasks: [], total: 0 })
    expect(agentTaskService.listTasks('agent-missing')).toEqual({ tasks: [], total: 0 })
    expect(agentTaskService.getTaskById(trashedTaskId)).toBeNull()
    expect(agentTaskService.getTaskDetail(trashedTaskId)).toBeNull()
    expect(agentTaskService.getTask('agent-trashed', trashedTaskId)).toBeNull()
    expect(agentTaskService.getTaskById(missingTaskId)).toBeNull()
    expect(agentTaskService.getTaskDetail(missingTaskId)).toBeNull()
    expect(agentTaskService.getTask('agent-missing', missingTaskId)).toBeNull()

    dbh.db.update(agentTable).set({ deletedAt: null }).where(eq(agentTable.id, 'agent-trashed')).run()

    expect(new Set(agentTaskService.listAllTasks().tasks.map((task) => task.id))).toEqual(
      new Set([activeTaskId, trashedTaskId])
    )
    expect(agentTaskService.listTasks('agent-trashed').tasks.map((task) => task.id)).toEqual([trashedTaskId])
    expect(agentTaskService.getTaskById(trashedTaskId)).toMatchObject({
      id: trashedTaskId,
      agentId: 'agent-trashed'
    })
    expect(agentTaskService.getTask('agent-trashed', trashedTaskId)).toMatchObject({ id: trashedTaskId })
  })

  it.each(['pending', 'delayed'])(
    'reports %s as queued until execution starts, then reports its actual outcome',
    (status) => {
      seedAgent('agent-active')
      const taskId = seedTask('task-active', 'agent-active')
      expect(agentTaskService.getTaskDetail(taskId)?.runSummary).toBeNull()
      const now = Date.now()
      dbh.db
        .insert(jobTable)
        .values({
          id: 'run',
          type: 'agent.task',
          queue: 'agent:agent-active',
          scheduleId: taskId,
          status,
          scheduledAt: now,
          input: {}
        })
        .run()
      expect(agentTaskService.getTaskDetail(taskId)?.runSummary).toEqual({ status: 'queued' })

      dbh.db.update(jobTable).set({ status: 'running', startedAt: now }).where(eq(jobTable.id, 'run')).run()
      expect(agentTaskService.getTaskDetail(taskId)?.runSummary).toEqual({ status: 'running' })

      dbh.db
        .update(jobTable)
        .set({ status: 'failed', finishedAt: now + 1000 })
        .where(eq(jobTable.id, 'run'))
        .run()
      expect(agentTaskService.getTaskDetail(taskId)).toMatchObject({
        status: 'active',
        runSummary: { status: 'failed', finishedAt: new Date(now + 1000).toISOString() }
      })
    }
  )

  it('keeps an active execution visible when a newer run is queued', () => {
    seedAgent('agent-active')
    const taskId = seedTask('task-active', 'agent-active')
    const now = Date.now()
    dbh.db
      .insert(jobTable)
      .values([
        {
          id: 'running',
          type: 'agent.task',
          queue: 'agent:agent-active',
          scheduleId: taskId,
          status: 'running',
          scheduledAt: now,
          startedAt: now,
          input: {}
        },
        {
          id: 'queued',
          type: 'agent.task',
          queue: 'agent:agent-active',
          scheduleId: taskId,
          status: 'pending',
          scheduledAt: now + 1000,
          input: {}
        }
      ])
      .run()
    expect(agentTaskService.getTaskDetail(taskId)?.runSummary).toEqual({ status: 'running' })
  })

  it('filters before pagination and keeps consumed once schedules out of paused tasks', () => {
    seedAgent('owner')
    const active = new Set<string>()
    const paused = new Set<string>()
    for (let i = 0; i < 55; i++) {
      active.add(seedTask(`active-${i}`, 'owner'))
      const id = seedTask(`paused-${i}`, 'owner')
      jobScheduleService.update(id, { enabled: false })
      paused.add(id)
    }
    const once = seedTask('once', 'owner')
    jobScheduleService.update(once, { trigger: { kind: 'once', at: 1000 }, enabled: false })
    jobScheduleService.markFiredTx(dbh.db, once, 2000, null)
    const missed = seedTask('missed', 'owner')
    jobScheduleService.update(missed, { enabled: false, metadata: { missed: { reason: 'agent_archived' } } })
    for (const [status, ids] of [
      ['active', active],
      ['paused', paused]
    ] as const) {
      const first = agentTaskService.listAllTasks({ status, limit: 50 })
      const second = agentTaskService.listAllTasks({ status, limit: 50, offset: 50 })
      expect(first.total).toBe(55)
      expect(second.total).toBe(55)
      expect(first.tasks).toHaveLength(50)
      expect(second.tasks).toHaveLength(5)
      expect(new Set([...first.tasks, ...second.tasks].map((task) => task.id))).toEqual(ids)
    }
    expect(agentTaskService.listAllTasks({ status: 'completed' }).tasks.map((task) => task.id)).toEqual([once])
    expect(agentTaskService.listAllTasks({ status: 'missed' }).tasks.map((task) => task.id)).toEqual([missed])
    expect(agentTaskService.listAllTasks().total).toBe(112)
  })

  it('returns later execution pages with the full total and task isolation', () => {
    seedAgent('owner')
    const taskId = seedTask('history', 'owner')
    const other = seedTask('other', 'owner')
    for (let i = 0; i < 105; i++) {
      dbh.db
        .insert(jobTable)
        .values({
          id: `run-${i}`,
          type: 'agent.task',
          queue: 'agent:owner',
          scheduleId: taskId,
          status: 'completed',
          scheduledAt: i,
          createdAt: i,
          input: {},
          metadata: { sessionId: `session-${i}` }
        })
        .run()
    }
    dbh.db
      .insert(jobTable)
      .values({
        id: 'other-run',
        type: 'agent.task',
        queue: 'agent:owner',
        scheduleId: other,
        status: 'completed',
        scheduledAt: 1000,
        input: {}
      })
      .run()
    const page = agentTaskService.getTaskLogs(taskId, { limit: 50, offset: 100 })
    expect(page.total).toBe(105)
    expect(page.logs.map((log) => log.id)).toEqual(['run-4', 'run-3', 'run-2', 'run-1', 'run-0'])
    expect(page.logs[0].sessionId).toBe('session-4')
  })
})

describe('AgentTaskService ownership mutation contract', () => {
  const dbh = setupTestDatabase()

  it.each(['targeted', 'reconciliation'] as const)(
    '%s returns deleted schedules without deciding workspace ownership',
    (mode) => {
      dbh.db
        .insert(agentWorkspaceTable)
        .values({ id: 'workspace', type: 'user', name: 'Workspace', path: '/tmp/task-workspace', orderKey: 'a0' })
        .run()
      const schedule = jobScheduleService.create({
        type: 'agent.task',
        name: 'heartbeat_missing',
        trigger: { kind: 'interval', ms: 60_000 },
        jobInputTemplate: {
          agentId: 'missing',
          prompt: '__heartbeat__',
          workspace: { type: 'user', workspaceId: 'workspace' }
        },
        catchUpPolicy: { kind: 'skip-missed' }
      })

      const result = dbh.db.transaction((tx) =>
        mode === 'targeted'
          ? agentTaskService.setOwnerStateTx(tx, 'missing', 'missing', Date.now())
          : agentTaskService.reconcileOwnerStatesTx(tx, Date.now())
      )

      expect(jobScheduleService.getById(schedule.id)).toBeNull()
      expect(dbh.db.select().from(agentWorkspaceTable).all()).toMatchObject([{ id: 'workspace' }])
      expect(result).toEqual({ scheduleIds: [schedule.id], deletedSchedules: [schedule] })
    }
  )
})
