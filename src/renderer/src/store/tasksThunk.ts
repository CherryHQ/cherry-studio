/**
 * Thunks for task synchronization with main process
 */

import { loggerService } from '@logger'
import type { CreateTaskForm, PeriodicTask, TaskExecution } from '@types'

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
  console.log('[TASKS] executeTask thunk 开始，taskId:', taskId)
  logger.info(`executeTask thunk 开始，taskId: ${taskId}`)

  const task = getState().tasks.tasks.find((t) => t.id === taskId)
  if (!task) {
    throw new Error(`未找到任务：${taskId}`)
  }

  console.log('[TASKS] 找到任务:', task.name, '目标数量:', task.targets.length)
  logger.info(`找到任务：${task.name}，目标数量：${task.targets.length}`)

  // 1. 先创建一个 running 状态的执行记录
  const tempExecutionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  const runningExecution: TaskExecution = {
    id: tempExecutionId,
    taskId,
    status: 'running',
    startedAt: new Date().toISOString()
  }

  console.log('[TASKS] 添加 running 状态的执行记录:', tempExecutionId)
  logger.info(`添加 running 状态的执行记录：${tempExecutionId}`)

  // 立即添加 running 记录到 store
  dispatch(addExecution({ taskId, execution: runningExecution }))

  let finalExecution: TaskExecution

  try {
    // 2. 异步执行任务（使用相同的 executionId）
    console.log('[TASKS] 准备调用 executeTaskDirect')
    logger.info(`准备调用 executeTaskDirect，使用 executionId: ${tempExecutionId}`)
    const { executeTaskDirect } = await import('@renderer/services/TaskExecutionService')
    console.log('[TASKS] executeTaskDirect 导入成功，开始执行')
    logger.info(`executeTaskDirect 导入成功，开始执行`)

    finalExecution = await executeTaskDirect(task, tempExecutionId)

    console.log('[TASKS] executeTaskDirect 返回，执行状态:', finalExecution.status)
    logger.info(`executeTaskDirect 返回，执行状态：${finalExecution.status}`)
  } catch (error) {
    // Create a failed execution record if execution failed
    console.error('[TASKS] 执行任务失败:', error)
    logger.error('执行任务失败：', error as Error)
    finalExecution = {
      id: tempExecutionId,
      taskId,
      status: 'failed',
      startedAt: runningExecution.startedAt,
      completedAt: new Date().toISOString(),
      result: {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: 0
      }
    }
    console.log('[TASKS] 创建失败执行记录:', finalExecution.status, '使用相同的 executionId:', tempExecutionId)
    logger.info(`创建失败执行记录：${finalExecution.status}，executionId: ${tempExecutionId}`)
  }

  // 3. 用最终的执行记录更新（替换 running 记录）
  console.log('[TASKS] 更新执行记录为最终状态:', finalExecution.status)
  logger.info(`更新执行记录为最终状态：${finalExecution.status}`)

  // Save execution to storage via main process
  if (window.api.task.saveExecution) {
    try {
      console.log('[TASKS] 保存执行记录到存储:', finalExecution.id)
      logger.info(`保存执行记录到存储：${finalExecution.id}`)
      await window.api.task.saveExecution(taskId, finalExecution)
      console.log('[TASKS] 执行记录保存成功')
      logger.info(`执行记录保存成功`)
    } catch (saveError) {
      console.error('[TASKS] 保存执行记录失败:', saveError)
      logger.warn('保存执行记录失败：', saveError as Error)
    }
  } else {
    console.log('[TASKS] saveExecution API 不可用')
    logger.warn('saveExecution API 不可用，执行记录未保存到存储')
  }

  // 4. 用最终状态替换 running 状态
  dispatch(addExecution({ taskId, execution: finalExecution }))
  console.log('[TASKS] addExecution action 分发完成')
  logger.info(`addExecution action 分发完成`)

  return finalExecution
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
