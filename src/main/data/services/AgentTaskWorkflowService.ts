import { schedulerService } from '@main/services/agents/services/SchedulerService'
import type { CreateTaskDto, UpdateTaskDto } from '@shared/data/api/schemas/agents'

import { agentTaskService } from './AgentTaskService'

export class AgentTaskWorkflowService {
  async createTask(agentId: string, data: CreateTaskDto) {
    const task = await agentTaskService.createTask(agentId, data)
    schedulerService.startLoop()
    return task
  }

  async updateTask(agentId: string, taskId: string, updates: UpdateTaskDto) {
    const task = await agentTaskService.updateTask(agentId, taskId, updates)
    if (task) {
      await schedulerService.syncScheduler()
    }
    return task
  }

  async deleteTask(agentId: string, taskId: string) {
    const deleted = await agentTaskService.deleteTask(agentId, taskId)
    if (deleted) {
      await schedulerService.syncScheduler()
    }
    return deleted
  }
}

export const agentTaskWorkflowService = new AgentTaskWorkflowService()
