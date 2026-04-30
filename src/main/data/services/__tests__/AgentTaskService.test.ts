import { agentTable } from '@data/db/schemas/agent'
import { agentTaskTable, type InsertAgentTaskRow } from '@data/db/schemas/agentTask'
import { agentTaskService as taskService } from '@data/services/AgentTaskService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import type { CreateTaskRequest } from '@types'
import { describe, expect, it } from 'vitest'

describe('TaskService', () => {
  const dbh = setupTestDatabase()

  async function insertAgent(overrides: Partial<typeof agentTable.$inferInsert> = {}): Promise<{ id: string }> {
    const id = overrides.id ?? `agent_test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    await dbh.db.insert(agentTable).values({
      type: 'claude-code',
      name: 'Test Agent',
      instructions: 'You are a helpful assistant.',
      // `model` is FK-constrained to user_model.id; tests insert NULL to skip
      // the constraint since they don't exercise model behavior.
      model: null,
      sortOrder: 0,
      // Soul mode required for createTask to pass assertAutonomous
      configuration: { soul_enabled: true },
      ...overrides,
      id
    })
    return { id }
  }

  const baseRequest: CreateTaskRequest = {
    name: 'nightly report',
    prompt: 'summarise overnight alerts',
    scheduleType: 'interval',
    scheduleValue: '60'
  }

  describe('createTask', () => {
    it('throws notFound when the agent does not exist', async () => {
      await expect(taskService.createTask('nonexistent-agent-id', baseRequest)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('succeeds and returns the task when agent exists', async () => {
      const { id: agentId } = await insertAgent()

      const task = await taskService.createTask(agentId, baseRequest)

      expect(task).toMatchObject({
        agentId,
        name: baseRequest.name,
        prompt: baseRequest.prompt,
        scheduleType: baseRequest.scheduleType,
        scheduleValue: baseRequest.scheduleValue,
        status: 'active'
      })
      expect(task.id).toMatch(/^task_/)
    })
  })

  describe('listTasks', () => {
    it('respects limit and offset', async () => {
      const { id: agentId } = await insertAgent()

      // Insert 5 tasks directly using the typed row shape
      for (let i = 0; i < 5; i++) {
        const taskRow: InsertAgentTaskRow = {
          id: `task_list_test_${i}_${Date.now()}`,
          agentId,
          name: `Task ${i}`,
          prompt: 'do something',
          scheduleType: 'interval',
          scheduleValue: '30',
          status: 'active'
        }
        await dbh.db.insert(agentTaskTable).values(taskRow)
      }

      const page1 = await taskService.listTasks(agentId, { limit: 2, offset: 0 })
      const page2 = await taskService.listTasks(agentId, { limit: 2, offset: 2 })

      expect(page1.tasks).toHaveLength(2)
      expect(page2.tasks).toHaveLength(2)
      expect(page1.total).toBe(5)

      const ids1 = page1.tasks.map((t) => t.id)
      const ids2 = page2.tasks.map((t) => t.id)
      expect(ids1.some((id) => ids2.includes(id))).toBe(false)
    })
  })
})
