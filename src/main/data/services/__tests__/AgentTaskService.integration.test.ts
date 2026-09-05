import { agentTable } from '@data/db/schemas/agent'
import { agentTaskService } from '@data/services/AgentTaskService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

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
    expect(agentTaskService.getTask('agent-trashed', trashedTaskId)).toBeNull()
    expect(agentTaskService.getTaskById(missingTaskId)).toBeNull()
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
})
