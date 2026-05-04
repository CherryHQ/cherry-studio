import { loggerService } from '@logger'
import { schedulerService } from '@main/services/agents/services/SchedulerService'
import type { CreateTaskDto, UpdateTaskDto } from '@shared/data/api/schemas/agents'

import { agentTaskService } from './AgentTaskService'

const logger = loggerService.withContext('AgentTaskWorkflowService')

export class AgentTaskWorkflowService {
  async createTask(agentId: string, data: CreateTaskDto) {
    const task = await agentTaskService.createTask(agentId, data)
    try {
      schedulerService.startLoop()
    } catch (err) {
      logger.warn('Failed to start scheduler after task create', err instanceof Error ? err : new Error(String(err)))
    }
    return task
  }

  async updateTask(agentId: string, taskId: string, updates: UpdateTaskDto) {
    const task = await agentTaskService.updateTask(agentId, taskId, updates)
    if (task) {
      try {
        await schedulerService.syncScheduler()
      } catch (err) {
        logger.warn('Failed to sync scheduler after task update', err instanceof Error ? err : new Error(String(err)))
      }
    }
    return task
  }

  async deleteTask(agentId: string, taskId: string) {
    const deleted = await agentTaskService.deleteTask(agentId, taskId)
    if (deleted) {
      try {
        await schedulerService.syncScheduler()
      } catch (err) {
        logger.warn('Failed to sync scheduler after task delete', err instanceof Error ? err : new Error(String(err)))
      }
    }
    return deleted
  }
}

export const agentTaskWorkflowService = new AgentTaskWorkflowService()
