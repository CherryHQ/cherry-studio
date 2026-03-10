import { loggerService } from '@logger'
import { taskService } from '@main/services/agents/services/TaskService'
import type { ListTaskLogsResponse, ListTasksResponse } from '@types'
import type { Request, Response } from 'express'

const logger = loggerService.withContext('ApiServerTasksHandlers')

export const createTask = async (req: Request, res: Response): Promise<Response> => {
  const { agentId } = req.params
  try {
    logger.debug('Creating task', { agentId })
    const task = await taskService.createTask(agentId, req.body)
    logger.info('Task created', { agentId, taskId: task.id })
    return res.status(201).json(task)
  } catch (error: any) {
    logger.error('Error creating task', { error, agentId })
    return res.status(500).json({
      error: {
        message: `Failed to create task: ${error.message}`,
        type: 'internal_error',
        code: 'task_creation_failed'
      }
    })
  }
}

export const listTasks = async (req: Request, res: Response): Promise<Response> => {
  const { agentId } = req.params
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0

    logger.debug('Listing tasks', { agentId, limit, offset })
    const result = await taskService.listTasks(agentId, { limit, offset })

    return res.json({
      data: result.tasks,
      total: result.total,
      limit,
      offset
    } satisfies ListTasksResponse)
  } catch (error: any) {
    logger.error('Error listing tasks', { error, agentId })
    return res.status(500).json({
      error: {
        message: 'Failed to list tasks',
        type: 'internal_error',
        code: 'task_list_failed'
      }
    })
  }
}

export const getTask = async (req: Request, res: Response): Promise<Response> => {
  const { agentId, taskId } = req.params
  try {
    logger.debug('Getting task', { agentId, taskId })
    const task = await taskService.getTask(agentId, taskId)

    if (!task) {
      return res.status(404).json({
        error: {
          message: 'Task not found',
          type: 'not_found',
          code: 'task_not_found'
        }
      })
    }

    return res.json(task)
  } catch (error: any) {
    logger.error('Error getting task', { error, agentId, taskId })
    return res.status(500).json({
      error: {
        message: 'Failed to get task',
        type: 'internal_error',
        code: 'task_get_failed'
      }
    })
  }
}

export const updateTask = async (req: Request, res: Response): Promise<Response> => {
  const { agentId, taskId } = req.params
  try {
    logger.debug('Updating task', { agentId, taskId })
    const task = await taskService.updateTask(agentId, taskId, req.body)

    if (!task) {
      return res.status(404).json({
        error: {
          message: 'Task not found',
          type: 'not_found',
          code: 'task_not_found'
        }
      })
    }

    logger.info('Task updated', { agentId, taskId })
    return res.json(task)
  } catch (error: any) {
    logger.error('Error updating task', { error, agentId, taskId })
    return res.status(500).json({
      error: {
        message: `Failed to update task: ${error.message}`,
        type: 'internal_error',
        code: 'task_update_failed'
      }
    })
  }
}

export const deleteTask = async (req: Request, res: Response): Promise<Response> => {
  const { agentId, taskId } = req.params
  try {
    logger.debug('Deleting task', { agentId, taskId })
    const deleted = await taskService.deleteTask(agentId, taskId)

    if (!deleted) {
      return res.status(404).json({
        error: {
          message: 'Task not found',
          type: 'not_found',
          code: 'task_not_found'
        }
      })
    }

    logger.info('Task deleted', { agentId, taskId })
    return res.status(204).send()
  } catch (error: any) {
    logger.error('Error deleting task', { error, agentId, taskId })
    return res.status(500).json({
      error: {
        message: 'Failed to delete task',
        type: 'internal_error',
        code: 'task_delete_failed'
      }
    })
  }
}

export const getTaskLogs = async (req: Request, res: Response): Promise<Response> => {
  const { agentId, taskId } = req.params
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0

    // Verify the task belongs to this agent
    const task = await taskService.getTask(agentId, taskId)
    if (!task) {
      return res.status(404).json({
        error: {
          message: 'Task not found',
          type: 'not_found',
          code: 'task_not_found'
        }
      })
    }

    logger.debug('Getting task logs', { taskId, limit, offset })
    const result = await taskService.getTaskLogs(taskId, { limit, offset })

    return res.json({
      data: result.logs,
      total: result.total,
      limit,
      offset
    } satisfies ListTaskLogsResponse)
  } catch (error: any) {
    logger.error('Error getting task logs', { error, taskId })
    return res.status(500).json({
      error: {
        message: 'Failed to get task logs',
        type: 'internal_error',
        code: 'task_logs_failed'
      }
    })
  }
}
