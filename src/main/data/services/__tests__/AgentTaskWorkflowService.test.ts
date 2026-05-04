import { beforeEach, describe, expect, it, vi } from 'vitest'

const { startLoopMock, syncSchedulerMock } = vi.hoisted(() => ({
  startLoopMock: vi.fn(),
  syncSchedulerMock: vi.fn()
}))

vi.mock('@main/services/agents/services/SchedulerService', () => ({
  schedulerService: {
    startLoop: startLoopMock,
    syncScheduler: syncSchedulerMock
  }
}))

const { createTaskMock, updateTaskMock, deleteTaskMock } = vi.hoisted(() => ({
  createTaskMock: vi.fn(),
  updateTaskMock: vi.fn(),
  deleteTaskMock: vi.fn()
}))

vi.mock('@data/services/AgentTaskService', () => ({
  agentTaskService: {
    createTask: createTaskMock,
    updateTask: updateTaskMock,
    deleteTask: deleteTaskMock
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn()
    })
  }
}))

// Import AFTER mocks
import { agentTaskWorkflowService } from '../AgentTaskWorkflowService'

const makeTask = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  agentId: 'agent-1',
  name: 'Test Task',
  schedule: '* * * * *',
  isActive: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides
})

describe('AgentTaskWorkflowService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createTask', () => {
    it('calls startLoop() after successful DB operation', async () => {
      const task = makeTask()
      createTaskMock.mockResolvedValue(task)

      await agentTaskWorkflowService.createTask('agent-1', {
        name: 'Test Task',
        prompt: 'do it',
        scheduleType: 'interval' as const,
        scheduleValue: '60'
      })

      expect(startLoopMock).toHaveBeenCalledTimes(1)
    })

    it('returns the created task even when startLoop throws', async () => {
      const task = makeTask()
      createTaskMock.mockResolvedValue(task)
      startLoopMock.mockImplementation(() => {
        throw new Error('scheduler unavailable')
      })

      const result = await agentTaskWorkflowService.createTask('agent-1', {
        name: 'Test Task',
        prompt: 'do it',
        scheduleType: 'interval' as const,
        scheduleValue: '60'
      })

      expect(result).toEqual(task)
    })

    it('returns the created task on success', async () => {
      const task = makeTask()
      createTaskMock.mockResolvedValue(task)
      startLoopMock.mockReturnValue(undefined)

      const result = await agentTaskWorkflowService.createTask('agent-1', {
        name: 'Test Task',
        prompt: 'do it',
        scheduleType: 'interval' as const,
        scheduleValue: '60'
      })

      expect(result).toEqual(task)
    })
  })

  describe('updateTask', () => {
    it('calls syncScheduler() when task update succeeds', async () => {
      const task = makeTask({ name: 'Updated Task' })
      updateTaskMock.mockResolvedValue(task)
      syncSchedulerMock.mockResolvedValue(undefined)

      await agentTaskWorkflowService.updateTask('agent-1', 'task-1', { name: 'Updated Task' })

      expect(syncSchedulerMock).toHaveBeenCalledTimes(1)
    })

    it('does NOT call syncScheduler() when task update returns null', async () => {
      updateTaskMock.mockResolvedValue(null)

      const result = await agentTaskWorkflowService.updateTask('agent-1', 'task-1', { name: 'Updated Task' })

      expect(result).toBeNull()
      expect(syncSchedulerMock).not.toHaveBeenCalled()
    })

    it('does NOT call syncScheduler() when task update returns undefined', async () => {
      updateTaskMock.mockResolvedValue(undefined)

      await agentTaskWorkflowService.updateTask('agent-1', 'task-1', { name: 'Updated Task' })

      expect(syncSchedulerMock).not.toHaveBeenCalled()
    })

    it('returns the task even when syncScheduler throws', async () => {
      const task = makeTask({ name: 'Updated Task' })
      updateTaskMock.mockResolvedValue(task)
      syncSchedulerMock.mockRejectedValue(new Error('scheduler sync failed'))

      const result = await agentTaskWorkflowService.updateTask('agent-1', 'task-1', { name: 'Updated Task' })

      expect(result).toEqual(task)
    })

    it('returns the task on success', async () => {
      const task = makeTask({ name: 'Updated Task' })
      updateTaskMock.mockResolvedValue(task)
      syncSchedulerMock.mockResolvedValue(undefined)

      const result = await agentTaskWorkflowService.updateTask('agent-1', 'task-1', { name: 'Updated Task' })

      expect(result).toEqual(task)
    })
  })

  describe('deleteTask', () => {
    it('calls syncScheduler() when delete succeeds (returns true)', async () => {
      deleteTaskMock.mockResolvedValue(true)
      syncSchedulerMock.mockResolvedValue(undefined)

      await agentTaskWorkflowService.deleteTask('agent-1', 'task-1')

      expect(syncSchedulerMock).toHaveBeenCalledTimes(1)
    })

    it('does NOT call syncScheduler() when delete returns false', async () => {
      deleteTaskMock.mockResolvedValue(false)

      const result = await agentTaskWorkflowService.deleteTask('agent-1', 'task-1')

      expect(result).toBe(false)
      expect(syncSchedulerMock).not.toHaveBeenCalled()
    })

    it('returns the deleted result (true) even when syncScheduler throws', async () => {
      deleteTaskMock.mockResolvedValue(true)
      syncSchedulerMock.mockRejectedValue(new Error('scheduler sync failed'))

      const result = await agentTaskWorkflowService.deleteTask('agent-1', 'task-1')

      expect(result).toBe(true)
    })

    it('returns false when task not found (deleteTask returns false)', async () => {
      deleteTaskMock.mockResolvedValue(false)

      const result = await agentTaskWorkflowService.deleteTask('agent-1', 'nonexistent')

      expect(result).toBe(false)
    })
  })
})
