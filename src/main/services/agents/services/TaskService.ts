import { loggerService } from '@logger'
import type { CreateTaskRequest, ListOptions, ScheduledTaskEntity, TaskRunLogEntity, UpdateTaskRequest } from '@types'
import { and, asc, count, desc, eq, lte, ne } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import {
  type InsertTaskRow,
  type InsertTaskRunLogRow,
  scheduledTasksTable,
  type TaskRow,
  taskRunLogsTable
} from '../database/schema'

const logger = loggerService.withContext('TaskService')

export class TaskService extends BaseService {
  private static instance: TaskService | null = null

  static getInstance(): TaskService {
    if (!TaskService.instance) {
      TaskService.instance = new TaskService()
    }
    return TaskService.instance
  }

  async createTask(agentId: string, req: CreateTaskRequest): Promise<ScheduledTaskEntity> {
    const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    const now = new Date().toISOString()

    const nextRun = this.computeInitialNextRun(req.schedule_type, req.schedule_value)

    const insertData: InsertTaskRow = {
      id,
      agent_id: agentId,
      name: req.name,
      prompt: req.prompt,
      schedule_type: req.schedule_type,
      schedule_value: req.schedule_value,
      context_mode: req.context_mode ?? 'session',
      next_run: nextRun,
      status: 'active',
      created_at: now,
      updated_at: now
    }

    const database = await this.getDatabase()
    await database.insert(scheduledTasksTable).values(insertData)
    const result = await database.select().from(scheduledTasksTable).where(eq(scheduledTasksTable.id, id)).limit(1)

    if (!result[0]) {
      throw new Error('Failed to create task')
    }

    logger.info('Task created', { taskId: id, agentId })
    return result[0] as ScheduledTaskEntity
  }

  async getTask(agentId: string, taskId: string): Promise<ScheduledTaskEntity | null> {
    const database = await this.getDatabase()
    const result = await database
      .select()
      .from(scheduledTasksTable)
      .where(and(eq(scheduledTasksTable.id, taskId), eq(scheduledTasksTable.agent_id, agentId)))
      .limit(1)

    return (result[0] as ScheduledTaskEntity) ?? null
  }

  async listTasks(
    agentId: string,
    options: ListOptions & { includeHeartbeat?: boolean } = {}
  ): Promise<{ tasks: ScheduledTaskEntity[]; total: number }> {
    const database = await this.getDatabase()
    const { includeHeartbeat = false, ...paginationOptions } = options

    // By default, exclude heartbeat tasks from the listing
    const whereCondition = includeHeartbeat
      ? eq(scheduledTasksTable.agent_id, agentId)
      : and(eq(scheduledTasksTable.agent_id, agentId), ne(scheduledTasksTable.name, 'heartbeat'))

    const totalResult = await database.select({ count: count() }).from(scheduledTasksTable).where(whereCondition)

    const baseQuery = database
      .select()
      .from(scheduledTasksTable)
      .where(whereCondition)
      .orderBy(desc(scheduledTasksTable.created_at))

    const result =
      paginationOptions.limit !== undefined
        ? paginationOptions.offset !== undefined
          ? await baseQuery.limit(paginationOptions.limit).offset(paginationOptions.offset)
          : await baseQuery.limit(paginationOptions.limit)
        : await baseQuery

    return {
      tasks: result as ScheduledTaskEntity[],
      total: totalResult[0].count
    }
  }

  async updateTask(agentId: string, taskId: string, updates: UpdateTaskRequest): Promise<ScheduledTaskEntity | null> {
    const existing = await this.getTask(agentId, taskId)
    if (!existing) return null

    const now = new Date().toISOString()
    const updateData: Partial<TaskRow> = { updated_at: now }

    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.prompt !== undefined) updateData.prompt = updates.prompt
    if (updates.context_mode !== undefined) updateData.context_mode = updates.context_mode
    if (updates.status !== undefined) updateData.status = updates.status

    // If schedule type or value changed, recompute next_run
    if (updates.schedule_type !== undefined || updates.schedule_value !== undefined) {
      const schedType = updates.schedule_type ?? existing.schedule_type
      const schedValue = updates.schedule_value ?? existing.schedule_value
      updateData.schedule_type = schedType
      updateData.schedule_value = schedValue
      updateData.next_run = this.computeInitialNextRun(schedType, schedValue)
    }

    // If resuming from paused, recompute next_run
    if (updates.status === 'active' && existing.status === 'paused') {
      const schedType = updates.schedule_type ?? existing.schedule_type
      const schedValue = updates.schedule_value ?? existing.schedule_value
      updateData.next_run = this.computeInitialNextRun(schedType, schedValue)
    }

    const database = await this.getDatabase()
    await database
      .update(scheduledTasksTable)
      .set(updateData)
      .where(and(eq(scheduledTasksTable.id, taskId), eq(scheduledTasksTable.agent_id, agentId)))

    logger.info('Task updated', { taskId, agentId })
    return this.getTask(agentId, taskId)
  }

  async deleteTask(agentId: string, taskId: string): Promise<boolean> {
    const database = await this.getDatabase()
    const result = await database
      .delete(scheduledTasksTable)
      .where(and(eq(scheduledTasksTable.id, taskId), eq(scheduledTasksTable.agent_id, agentId)))

    logger.info('Task deleted', { taskId, agentId })
    return result.rowsAffected > 0
  }

  // --- Due tasks (used by SchedulerService poll loop) ---

  async getDueTasks(): Promise<ScheduledTaskEntity[]> {
    const now = new Date().toISOString()
    const database = await this.getDatabase()
    const result = await database
      .select()
      .from(scheduledTasksTable)
      .where(and(eq(scheduledTasksTable.status, 'active'), lte(scheduledTasksTable.next_run, now)))
      .orderBy(asc(scheduledTasksTable.next_run))

    return result as ScheduledTaskEntity[]
  }

  async updateTaskAfterRun(taskId: string, nextRun: string | null, lastResult: string): Promise<void> {
    const now = new Date().toISOString()
    const updateData: Partial<TaskRow> = {
      last_run: now,
      last_result: lastResult,
      next_run: nextRun,
      updated_at: now
    }

    // Mark one-time tasks as completed
    if (nextRun === null) {
      updateData.status = 'completed'
    }

    const database = await this.getDatabase()
    await database.update(scheduledTasksTable).set(updateData).where(eq(scheduledTasksTable.id, taskId))
  }

  // --- Task run logs ---

  async logTaskRun(log: Omit<InsertTaskRunLogRow, 'id'>): Promise<void> {
    const database = await this.getDatabase()
    await database.insert(taskRunLogsTable).values(log)
  }

  async getTaskLogs(taskId: string, options: ListOptions = {}): Promise<{ logs: TaskRunLogEntity[]; total: number }> {
    const database = await this.getDatabase()

    const totalResult = await database
      .select({ count: count() })
      .from(taskRunLogsTable)
      .where(eq(taskRunLogsTable.task_id, taskId))

    const baseQuery = database
      .select()
      .from(taskRunLogsTable)
      .where(eq(taskRunLogsTable.task_id, taskId))
      .orderBy(desc(taskRunLogsTable.run_at))

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    return {
      logs: result as unknown as TaskRunLogEntity[],
      total: totalResult[0].count
    }
  }

  // --- Next run computation (nanoclaw-inspired, drift-resistant) ---

  computeNextRun(task: ScheduledTaskEntity): string | null {
    if (task.schedule_type === 'once') return null

    const now = Date.now()

    if (task.schedule_type === 'cron') {
      try {
        const { CronExpressionParser } = require('cron-parser')
        const interval = CronExpressionParser.parse(task.schedule_value)
        return interval.next().toISOString()
      } catch {
        logger.warn('Invalid cron expression', { taskId: task.id, cron: task.schedule_value })
        return null
      }
    }

    if (task.schedule_type === 'interval') {
      const minutes = parseInt(task.schedule_value, 10)
      const ms = minutes * 60_000
      if (!ms || ms <= 0) {
        logger.warn('Invalid interval value', { taskId: task.id, value: task.schedule_value })
        return new Date(now + 60_000).toISOString()
      }

      // Anchor to scheduled time to prevent drift
      let next = new Date(task.next_run!).getTime() + ms
      while (next <= now) {
        next += ms
      }
      return new Date(next).toISOString()
    }

    return null
  }

  private computeInitialNextRun(scheduleType: string, scheduleValue: string): string | null {
    const now = Date.now()

    switch (scheduleType) {
      case 'cron': {
        try {
          const { CronExpressionParser } = require('cron-parser')
          const interval = CronExpressionParser.parse(scheduleValue)
          return interval.next().toISOString()
        } catch {
          return null
        }
      }
      case 'interval': {
        const minutes = parseInt(scheduleValue, 10)
        if (!minutes || minutes <= 0) return null
        return new Date(now + minutes * 60_000).toISOString()
      }
      case 'once': {
        // schedule_value is an ISO timestamp for once
        return scheduleValue
      }
      default:
        return null
    }
  }
}

export const taskService = TaskService.getInstance()
