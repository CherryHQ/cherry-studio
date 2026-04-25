import { loggerService } from '@logger'
import type { CreateTaskRequest, ListOptions, ScheduledTaskEntity, TaskRunLogEntity, UpdateTaskRequest } from '@types'
import { and, asc, count, desc, eq, inArray, lte, ne } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import {
  agentsTable,
  channelTaskSubscriptionsTable,
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
    await this.assertAutonomous(agentId)

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
      ...(req.timeout_minutes != null ? { timeout_minutes: req.timeout_minutes } : {}),
      next_run: nextRun,
      status: 'active',
      created_at: now,
      updated_at: now
    }

    const database = await this.getDatabase()
    await database.insert(scheduledTasksTable).values(insertData)

    // Create channel subscriptions
    if (req.channel_ids?.length) {
      await database
        .insert(channelTaskSubscriptionsTable)
        .values(req.channel_ids.map((channelId) => ({ channelId, taskId: id })))
        .onConflictDoNothing()
    }

    logger.info('Task created', { taskId: id, agentId })
    return this.getTaskWithChannels(id)
  }

  /** Fetch a task row enriched with its subscribed channel_ids. */
  private async getTaskWithChannels(taskId: string): Promise<ScheduledTaskEntity> {
    const database = await this.getDatabase()
    const result = await database.select().from(scheduledTasksTable).where(eq(scheduledTasksTable.id, taskId)).limit(1)
    if (!result[0]) throw new Error('Task not found')
    return this.enrichWithChannels(result[0])
  }

  async getTask(agentId: string, taskId: string): Promise<ScheduledTaskEntity | null> {
    const database = await this.getDatabase()
    const result = await database
      .select()
      .from(scheduledTasksTable)
      .where(and(eq(scheduledTasksTable.id, taskId), eq(scheduledTasksTable.agent_id, agentId)))
      .limit(1)

    if (!result[0]) return null
    return this.enrichWithChannels(result[0])
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
      tasks: await this.enrichManyWithChannels(result),
      total: totalResult[0].count
    }
  }

  async getTaskById(taskId: string): Promise<ScheduledTaskEntity | null> {
    const database = await this.getDatabase()
    const result = await database.select().from(scheduledTasksTable).where(eq(scheduledTasksTable.id, taskId)).limit(1)

    if (!result[0]) return null
    return this.enrichWithChannels(result[0])
  }

  async updateTaskById(taskId: string, updates: UpdateTaskRequest): Promise<ScheduledTaskEntity | null> {
    const existing = await this.getTaskById(taskId)
    if (!existing) return null

    const now = new Date().toISOString()
    const updateData: Partial<TaskRow> = { updated_at: now }

    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.prompt !== undefined) updateData.prompt = updates.prompt
    if (updates.agent_id !== undefined) updateData.agent_id = updates.agent_id
    if (updates.timeout_minutes !== undefined) updateData.timeout_minutes = updates.timeout_minutes ?? 2
    if (updates.status !== undefined) updateData.status = updates.status

    if (updates.schedule_type !== undefined || updates.schedule_value !== undefined) {
      const schedType = updates.schedule_type ?? existing.schedule_type
      const schedValue = updates.schedule_value ?? existing.schedule_value
      updateData.schedule_type = schedType
      updateData.schedule_value = schedValue
      updateData.next_run = this.computeInitialNextRun(schedType, schedValue)
    }

    if (updates.status === 'active' && existing.status === 'paused') {
      const schedType = updates.schedule_type ?? existing.schedule_type
      const schedValue = updates.schedule_value ?? existing.schedule_value
      updateData.next_run = this.computeInitialNextRun(schedType, schedValue)
    }

    const database = await this.getDatabase()
    await database.update(scheduledTasksTable).set(updateData).where(eq(scheduledTasksTable.id, taskId))

    // Sync channel subscriptions if provided
    if (updates.channel_ids !== undefined) {
      await this.syncTaskChannels(taskId, updates.channel_ids)
    }

    logger.info('Task updated', { taskId })
    return this.getTaskWithChannels(taskId)
  }

  async deleteTaskById(taskId: string): Promise<boolean> {
    const database = await this.getDatabase()
    const result = await database.delete(scheduledTasksTable).where(eq(scheduledTasksTable.id, taskId))

    logger.info('Task deleted', { taskId })
    return result.rowsAffected > 0
  }

  async listAllTasks(options: ListOptions = {}): Promise<{ tasks: ScheduledTaskEntity[]; total: number }> {
    const database = await this.getDatabase()
    const whereCondition = ne(scheduledTasksTable.name, 'heartbeat')

    const totalResult = await database.select({ count: count() }).from(scheduledTasksTable).where(whereCondition)

    const baseQuery = database
      .select()
      .from(scheduledTasksTable)
      .where(whereCondition)
      .orderBy(desc(scheduledTasksTable.created_at))

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    return {
      tasks: await this.enrichManyWithChannels(result),
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
    if (updates.timeout_minutes !== undefined) updateData.timeout_minutes = updates.timeout_minutes ?? 2
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

    // Sync channel subscriptions if provided
    if (updates.channel_ids !== undefined) {
      await this.syncTaskChannels(taskId, updates.channel_ids)
    }

    logger.info('Task updated', { taskId, agentId })
    return this.getTaskWithChannels(taskId)
  }

  /** Enrich a single task row with its subscribed channel_ids. */
  private async enrichWithChannels(row: TaskRow): Promise<ScheduledTaskEntity> {
    const database = await this.getDatabase()
    const subs = await database
      .select({ channelId: channelTaskSubscriptionsTable.channelId })
      .from(channelTaskSubscriptionsTable)
      .where(eq(channelTaskSubscriptionsTable.taskId, row.id))
    return { ...row, channel_ids: subs.map((s) => s.channelId) } as ScheduledTaskEntity
  }

  /** Enrich multiple task rows with their subscribed channel_ids (batched). */
  private async enrichManyWithChannels(rows: TaskRow[]): Promise<ScheduledTaskEntity[]> {
    if (rows.length === 0) return []
    const database = await this.getDatabase()
    const taskIds = rows.map((r) => r.id)
    const allSubs = await database
      .select()
      .from(channelTaskSubscriptionsTable)
      .where(inArray(channelTaskSubscriptionsTable.taskId, taskIds))
    const subsByTask = new Map<string, string[]>()
    for (const sub of allSubs) {
      const arr = subsByTask.get(sub.taskId) ?? []
      arr.push(sub.channelId)
      subsByTask.set(sub.taskId, arr)
    }
    return rows.map((row) => ({
      ...row,
      channel_ids: subsByTask.get(row.id) ?? []
    })) as ScheduledTaskEntity[]
  }

  /** Replace all channel subscriptions for a task. */
  private async syncTaskChannels(taskId: string, channelIds: string[]): Promise<void> {
    const database = await this.getDatabase()
    // Delete existing subscriptions
    await database.delete(channelTaskSubscriptionsTable).where(eq(channelTaskSubscriptionsTable.taskId, taskId))
    // Insert new ones
    if (channelIds.length > 0) {
      await database
        .insert(channelTaskSubscriptionsTable)
        .values(channelIds.map((channelId) => ({ channelId, taskId })))
        .onConflictDoNothing()
    }
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

  async hasActiveTasks(): Promise<boolean> {
    const database = await this.getDatabase()
    const [result] = await database
      .select({ count: count() })
      .from(scheduledTasksTable)
      .where(eq(scheduledTasksTable.status, 'active'))
    return (result?.count ?? 0) > 0
  }

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

  async logTaskRun(log: Omit<InsertTaskRunLogRow, 'id'>): Promise<number> {
    const database = await this.getDatabase()
    const result = await database.insert(taskRunLogsTable).values(log).returning({ id: taskRunLogsTable.id })
    return result[0].id
  }

  async updateTaskRunLog(
    logId: number,
    updates: Partial<Pick<InsertTaskRunLogRow, 'status' | 'result' | 'error' | 'duration_ms' | 'session_id'>>
  ): Promise<void> {
    const database = await this.getDatabase()
    await database.update(taskRunLogsTable).set(updates).where(eq(taskRunLogsTable.id, logId))
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

  /**
   * Get the session_id from the most recent successful run of a task.
   * Used by SchedulerService to reuse an existing session for context continuity.
   */
  async getLastRunSessionId(taskId: string): Promise<string | null> {
    const database = await this.getDatabase()
    const result = await database
      .select({ session_id: taskRunLogsTable.session_id })
      .from(taskRunLogsTable)
      .where(and(eq(taskRunLogsTable.task_id, taskId), eq(taskRunLogsTable.status, 'success')))
      .orderBy(desc(taskRunLogsTable.run_at))
      .limit(1)

    return result[0]?.session_id ?? null
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

  /**
   * Scheduled tasks require an autonomous agent — either Soul Mode
   * (soul_enabled) or bypassPermissions permission mode — otherwise
   * tool calls during task execution will fail with permission errors.
   */
  private async assertAutonomous(agentId: string): Promise<void> {
    const database = await this.getDatabase()
    const [row] = await database
      .select({ configuration: agentsTable.configuration })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .limit(1)

    if (!row) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    let config: Record<string, unknown> = {}
    if (row.configuration) {
      try {
        config = JSON.parse(row.configuration) as Record<string, unknown>
      } catch {
        // malformed JSON — treat as non-autonomous
      }
    }

    if (config.soul_enabled === true || config.permission_mode === 'bypassPermissions') {
      return
    }

    throw new Error('Scheduled tasks require Soul Mode or Bypass Permissions mode. Update the agent settings first.')
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
