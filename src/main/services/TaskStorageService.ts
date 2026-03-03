/**
 * Task Storage Service
 * Manages periodic tasks and execution history persistence
 */

import { loggerService } from '@logger'
import type { CreateTaskForm, PeriodicTask, TaskExecution, UpdateTaskForm } from '@types'
import Store from 'electron-store'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('TaskStorageService')

interface TaskStoreSchema {
  tasks: PeriodicTask[]
  executions: TaskExecution[]
}

class TaskStorageService {
  private static instance: TaskStorageService | null = null
  private store: Store<TaskStoreSchema>

  private constructor() {
    this.store = new Store<TaskStoreSchema>({
      name: 'tasks',
      accessPropertiesByDotNotation: false,
      defaults: {
        tasks: [],
        executions: []
      }
    })
    logger.info('TaskStorageService initialized')
  }

  public static getInstance(): TaskStorageService {
    if (!TaskStorageService.instance) {
      TaskStorageService.instance = new TaskStorageService()
    }
    return TaskStorageService.instance
  }

  /**
   * Create a new task
   */
  async createTask(form: CreateTaskForm): Promise<PeriodicTask> {
    const newTask: PeriodicTask = {
      ...form,
      id: `task-${uuidv4()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalRuns: 0,
      executions: []
    }

    const tasks = this.store.get('tasks', [])
    tasks.push(newTask)
    this.store.set('tasks', tasks)

    logger.info(`Task created: ${newTask.id}`)
    return newTask
  }

  /**
   * Update an existing task
   */
  async updateTask(form: UpdateTaskForm): Promise<PeriodicTask | null> {
    const tasks = this.store.get('tasks', [])
    const index = tasks.findIndex((t) => t.id === form.id)

    if (index === -1) {
      logger.warn(`Task not found for update: ${form.id}`)
      return null
    }

    const updatedTask: PeriodicTask = {
      ...tasks[index],
      ...form,
      updatedAt: new Date().toISOString()
    }

    tasks[index] = updatedTask
    this.store.set('tasks', tasks)

    logger.info(`Task updated: ${updatedTask.id}`)
    return updatedTask
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<boolean> {
    const tasks = this.store.get('tasks', [])
    const filtered = tasks.filter((t) => t.id !== taskId)

    if (filtered.length === tasks.length) {
      logger.warn(`Task not found for deletion: ${taskId}`)
      return false
    }

    this.store.set('tasks', filtered)

    // Clean up related executions
    const executions = this.store.get('executions', [])
    const filteredExecutions = executions.filter((e) => e.taskId !== taskId)
    this.store.set('executions', filteredExecutions)

    logger.info(`Task deleted: ${taskId}`)
    return true
  }

  /**
   * Get a single task by ID
   */
  async getTask(taskId: string): Promise<PeriodicTask | null> {
    const tasks = this.store.get('tasks', [])
    const task = tasks.find((t) => t.id === taskId)

    if (!task) {
      return null
    }

    // Load executions for this task
    const executions = this.store.get('executions', [])
    const taskExecutions = executions.filter((e) => e.taskId === taskId)

    return {
      ...task,
      executions: taskExecutions
    }
  }

  /**
   * List all tasks
   */
  async listTasks(): Promise<PeriodicTask[]> {
    const tasks = this.store.get('tasks', [])
    const executions = this.store.get('executions', [])

    return tasks.map((task) => ({
      ...task,
      executions: executions.filter((e) => e.taskId === task.id)
    }))
  }

  /**
   * Add an execution record
   */
  async addExecution(execution: TaskExecution): Promise<void> {
    const executions = this.store.get('executions', [])
    executions.unshift(execution)

    // Keep only last 100 executions per task
    const taskExecutions = executions.filter((e) => e.taskId === execution.taskId)
    if (taskExecutions.length > 100) {
      // Remove excess executions for this task
      const toRemove = taskExecutions.slice(100)
      const toRemoveIds = new Set(toRemove.map((e) => e.id))
      const filtered = executions.filter((e) => !toRemoveIds.has(e.id))
      this.store.set('executions', filtered)
    } else {
      this.store.set('executions', executions)
    }

    // Update task metadata
    await this.updateTaskMetadata(execution.taskId)

    logger.info(`Execution added: ${execution.id} for task: ${execution.taskId}`)
  }

  /**
   * Get executions for a task
   */
  async getExecutions(taskId: string, limit: number = 10): Promise<TaskExecution[]> {
    const executions = this.store.get('executions', [])
    const taskExecutions = executions.filter((e) => e.taskId === taskId)

    return taskExecutions.slice(0, limit)
  }

  /**
   * Update an execution record
   */
  async updateExecution(executionId: string, updates: Partial<TaskExecution>): Promise<boolean> {
    const executions = this.store.get('executions', [])
    const index = executions.findIndex((e) => e.id === executionId)

    if (index === -1) {
      logger.warn(`Execution not found for update: ${executionId}`)
      return false
    }

    executions[index] = {
      ...executions[index],
      ...updates
    }

    this.store.set('executions', executions)

    // Update task metadata if status changed
    if (updates.status) {
      await this.updateTaskMetadata(executions[index].taskId)
    }

    logger.info(`Execution updated: ${executionId}`)
    return true
  }

  /**
   * Update task metadata (lastRunAt, totalRuns)
   */
  private async updateTaskMetadata(taskId: string): Promise<void> {
    const tasks = this.store.get('tasks', [])
    const index = tasks.findIndex((t) => t.id === taskId)

    if (index === -1) {
      return
    }

    const executions = this.store.get('executions', [])
    const taskExecutions = executions.filter((e) => e.taskId === taskId)

    const lastExecution = taskExecutions[0] // Most recent

    tasks[index] = {
      ...tasks[index],
      totalRuns: taskExecutions.length,
      lastRunAt: lastExecution?.startedAt
    }

    this.store.set('tasks', tasks)
  }

  /**
   * Clear all data (for testing/debugging)
   */
  async clearAll(): Promise<void> {
    this.store.set('tasks', [])
    this.store.set('executions', [])
    logger.info('All task data cleared')
  }
}

export default TaskStorageService.getInstance()
