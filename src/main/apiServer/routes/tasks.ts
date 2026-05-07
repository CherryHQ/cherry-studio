import { loggerService } from '@logger'
import { schedulerService } from '@main/services/agents/services/SchedulerService'
import { taskService } from '@main/services/agents/services/TaskService'
import type { ListTaskLogsResponse, ListTasksResponse } from '@types'
import express, { type Request, type Response, type Router } from 'express'

const logger = loggerService.withContext('ApiServerTasksRoute')

const tasksRouter: Router = express.Router()

// GET /v1/tasks — list all tasks (excluding heartbeat)
tasksRouter.get('/', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0

    logger.debug('Listing all tasks', { limit, offset })
    const result = await taskService.listAllTasks({ limit, offset })

    return res.json({
      data: result.tasks,
      total: result.total,
      limit,
      offset
    } satisfies ListTasksResponse)
  } catch (error: any) {
    logger.error('Error listing all tasks', { error })
    return res.status(500).json({
      error: {
        message: 'Failed to list tasks',
        type: 'internal_error',
        code: 'task_list_failed'
      }
    })
  }
})

// POST /v1/tasks — create a task (agent_id in body)
tasksRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { agent_id, ...taskData } = req.body
    if (!agent_id) {
      return res.status(400).json({
        error: {
          message: 'agent_id is required',
          type: 'invalid_request',
          code: 'missing_agent_id'
        }
      })
    }

    logger.debug('Creating task', { agentId: agent_id })
    const task = await taskService.createTask(agent_id, taskData)
    schedulerService.startLoop()
    logger.info('Task created', { agentId: agent_id, taskId: task.id })
    return res.status(201).json(task)
  } catch (error: any) {
    logger.error('Error creating task', { error })
    return res.status(500).json({
      error: {
        message: `Failed to create task: ${error.message}`,
        type: 'internal_error',
        code: 'task_creation_failed'
      }
    })
  }
})

// GET /v1/tasks/:taskId
tasksRouter.get('/:taskId', async (req: Request, res: Response) => {
  const { taskId } = req.params
  try {
    logger.debug('Getting task', { taskId })
    const task = await taskService.getTaskById(taskId)

    if (!task) {
      return res.status(404).json({
        error: { message: 'Task not found', type: 'not_found', code: 'task_not_found' }
      })
    }

    return res.json(task)
  } catch (error: any) {
    logger.error('Error getting task', { error, taskId })
    return res.status(500).json({
      error: { message: 'Failed to get task', type: 'internal_error', code: 'task_get_failed' }
    })
  }
})

// PATCH /v1/tasks/:taskId
tasksRouter.patch('/:taskId', async (req: Request, res: Response) => {
  const { taskId } = req.params
  try {
    logger.debug('Updating task', { taskId })
    const task = await taskService.updateTaskById(taskId, req.body)

    if (!task) {
      return res.status(404).json({
        error: { message: 'Task not found', type: 'not_found', code: 'task_not_found' }
      })
    }

    void schedulerService.syncScheduler()
    logger.info('Task updated', { taskId })
    return res.json(task)
  } catch (error: any) {
    logger.error('Error updating task', { error, taskId })
    return res.status(500).json({
      error: {
        message: `Failed to update task: ${error.message}`,
        type: 'internal_error',
        code: 'task_update_failed'
      }
    })
  }
})

// DELETE /v1/tasks/:taskId
tasksRouter.delete('/:taskId', async (req: Request, res: Response) => {
  const { taskId } = req.params
  try {
    logger.debug('Deleting task', { taskId })
    const deleted = await taskService.deleteTaskById(taskId)

    if (!deleted) {
      return res.status(404).json({
        error: { message: 'Task not found', type: 'not_found', code: 'task_not_found' }
      })
    }

    void schedulerService.syncScheduler()
    logger.info('Task deleted', { taskId })
    return res.status(204).send()
  } catch (error: any) {
    logger.error('Error deleting task', { error, taskId })
    return res.status(500).json({
      error: { message: 'Failed to delete task', type: 'internal_error', code: 'task_delete_failed' }
    })
  }
})

// POST /v1/tasks/:taskId/run
tasksRouter.post('/:taskId/run', async (req: Request, res: Response) => {
  const { taskId } = req.params
  try {
    const task = await taskService.getTaskById(taskId)
    if (!task) {
      return res.status(404).json({
        error: { message: 'Task not found', type: 'not_found', code: 'task_not_found' }
      })
    }

    logger.debug('Manually running task', { taskId, agentId: task.agent_id })
    await schedulerService.runTaskNow(task.agent_id, taskId)
    logger.info('Task triggered manually', { taskId })
    return res.json({ status: 'triggered' })
  } catch (error: any) {
    const status = error.message?.includes('not found') ? 404 : error.message?.includes('already running') ? 409 : 500
    logger.error('Error running task', { error, taskId })
    return res.status(status).json({
      error: {
        message: `Failed to run task: ${error.message}`,
        type: status === 409 ? 'conflict' : status === 404 ? 'not_found' : 'internal_error',
        code: 'task_run_failed'
      }
    })
  }
})

// GET /v1/tasks/:taskId/logs
tasksRouter.get('/:taskId/logs', async (req: Request, res: Response) => {
  const { taskId } = req.params
  try {
    const task = await taskService.getTaskById(taskId)
    if (!task) {
      return res.status(404).json({
        error: { message: 'Task not found', type: 'not_found', code: 'task_not_found' }
      })
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0

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
      error: { message: 'Failed to get task logs', type: 'internal_error', code: 'task_logs_failed' }
    })
  }
})

export { tasksRouter }
