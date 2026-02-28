/**
 * Thunks for task synchronization with main process
 */

import { loggerService } from '@logger'
import type { CreateTaskForm, PeriodicTask } from '@types'

import type { AppDispatch, RootState } from './index'
import {
  addExecution,
  addMultipleTasks,
  addTask as addTaskAction,
  deleteTask as deleteTaskAction,
  updateTask as updateTaskAction
} from './tasks'

const logger = loggerService.withContext('tasksThunk')

// Thunk actions
export const createTask = (form: CreateTaskForm) => async (dispatch: AppDispatch) => {
  try {
    // Create task via main process (this saves to storage)
    const task = await window.api.task.create(form)

    // Update local state with the returned task (has proper ID)
    dispatch(addTaskAction(task))

    return task
  } catch (error) {
    logger.error('创建任务失败：', error as Error)
    throw error
  }
}

export const updateTask = (task: PeriodicTask) => async (dispatch: AppDispatch) => {
  try {
    // Update task via main process (this saves to storage)
    const updated = await window.api.task.update(task)

    if (updated) {
      // Update local state with the returned task
      dispatch(updateTaskAction(updated))
    }

    return updated
  } catch (error) {
    logger.error('更新任务失败：', error as Error)
    throw error
  }
}

export const deleteTask = (taskId: string) => async (dispatch: AppDispatch) => {
  try {
    // Delete task via main process
    await window.api.task.delete(taskId)

    // Update local state
    dispatch(deleteTaskAction(taskId))
  } catch (error) {
    logger.error('删除任务失败：', error as Error)
    throw error
  }
}

export const executeTask = (taskId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
  try {
    const task = getState().tasks.tasks.find((t) => t.id === taskId)
    if (!task) {
      throw new Error(`未找到任务：${taskId}`)
    }

    // Execute the task directly in renderer
    const { executeTaskDirect } = await import('@renderer/services/TaskExecutionService')
    const execution = await executeTaskDirect(task)

    // Save execution to storage via main process
    if (window.api.task.saveExecution) {
      await window.api.task.saveExecution(taskId, execution)
    } else {
      logger.warn('saveExecution API 不可用，执行记录未保存到存储')
    }

    // Update local state with execution
    dispatch(addExecution({ taskId, execution }))

    return execution
  } catch (error) {
    logger.error('执行任务失败：', error as Error)
    throw error
  }
}

export const toggleTaskEnabled = (taskId: string) => async (dispatch: AppDispatch, getState: () => RootState) => {
  const task = getState().tasks.tasks.find((t) => t.id === taskId)
  if (!task) return

  const updatedTask = { ...task, enabled: !task.enabled }
  await dispatch(updateTask(updatedTask))
}

export const pauseTask = (taskId: string) => async () => {
  await window.api.task.pause(taskId)
}

export const resumeTask = (taskId: string) => async () => {
  await window.api.task.resume(taskId)
}

export const loadTasksFromStorage = () => async (dispatch: AppDispatch) => {
  try {
    const tasks = await window.api.task.list()

    // Replace local tasks with stored tasks
    dispatch(addMultipleTasks(tasks.length > 0 ? tasks : []))
  } catch (error) {
    logger.error('加载任务失败：', error as Error)
  }
}
