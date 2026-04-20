import { loggerService } from '@logger'
import type { CreateTaskRequest, ListOptions, ScheduledTaskEntity, TaskRunLogEntity, UpdateTaskRequest } from '@types'
import { CronExpressionParser } from 'cron-parser'
import { and, asc, count, desc, eq, inArray, lte, ne } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import {
  agentsTable,
  channelTaskSubscriptionsTable,
  type InsertTaskRow,
  type InsertTaskRunLogRow,
  scheduledTasksTable,
  type TaskRow,
  type TaskRunLogRow,
  taskRunLogsTable
} from '../database/schema'

const logger = loggerService.withContext('TaskService')

export class TaskService extends BaseService {
  async createTask(agentId: string, req: CreateTaskRequest): Promise<ScheduledTaskEntity> {
    await this.assertAutonomous(agentId)

    const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

    const nextRun = this.computeInitialNextRun(req.schedule_type, req.schedule_value)

    const insertData: InsertTaskRow = {
      id,
      agentId,
      name: req.name,
      prompt: req.prompt,
      scheduleType: req.schedule_type,
      scheduleValue: req.schedule_value,
      ...(req.timeout_minutes != null ? { timeoutMinutes: req.timeout_minutes } : {}),
      nextRun,
      status: 'active'
    }

    const database = await this.getDatabase()
    await database.transaction(async (tx) => {
      const result = await tx.insert(scheduledTasksTable).values(insertData)
      if (result.rowsAffected !== 1) {
        throw new Error(`Failed to insert task ${id}: rowsAffected=${result.rowsAffected}`)
      }

      if (req.channel_ids?.length) {
        await tx
          .insert(channelTaskSubscriptionsTable)
          .values(req.channel_ids.map((channelId) => ({ channelId, taskId: id })))
          .onConflictDoNothing()
      }
    })

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
      .where(and(eq(scheduledTasksTable.id, taskId), eq(scheduledTasksTable.agentId, agentId)))
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
      ? eq(scheduledTasksTable.agentId, agentId)
      : and(eq(scheduledTasksTable.agentId, agentId), ne(scheduledTasksTable.name, 'heartbeat'))

    const totalResult = await database.select({ count: count() }).from(scheduledTasksTable).where(whereCondition)

    const baseQuery = database
      .select()
      .from(scheduledTasksTable)
      .where(whereCondition)
      .orderBy(desc(scheduledTasksTable.createdAt))

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

    const updateData: Partial<TaskRow> = { updatedAt: Date.now() }

    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.prompt !== undefined) updateData.prompt = updates.prompt
    if (updates.agent_id !== undefined) updateData.agentId = updates.agent_id
    if (updates.timeout_minutes !== undefined) updateData.timeoutMinutes = updates.timeout_minutes ?? 2
    if (updates.status !== undefined) updateData.status = updates.status

    if (updates.schedule_type !== undefined || updates.schedule_value !== undefined) {
      const schedType = updates.schedule_type ?? existing.schedule_type
      const schedValue = updates.schedule_value ?? existing.schedule_value
      updateData.scheduleType = schedType
      updateData.scheduleValue = schedValue
      updateData.nextRun = this.computeInitialNextRun(schedType, schedValue)
    }

    if (updates.status === 'active' && existing.status === 'paused') {
      const schedType = updates.schedule_type ?? existing.schedule_type
      const schedValue = updates.schedule_value ?? existing.schedule_value
      updateData.nextRun = this.computeInitialNextRun(schedType, schedValue)
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
      .orderBy(desc(scheduledTasksTable.createdAt))

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

    const updateData: Partial<TaskRow> = { updatedAt: Date.now() }

    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.prompt !== undefined) updateData.prompt = updates.prompt
    if (updates.timeout_minutes !== undefined) updateData.timeoutMinutes = updates.timeout_minutes ?? 2
    if (updates.status !== undefined) updateData.status = updates.status

    // If schedule type or value changed, recompute nextRun
    if (updates.schedule_type !== undefined || updates.schedule_value !== undefined) {
      const schedType = updates.schedule_type ?? existing.schedule_type
      const schedValue = updates.schedule_value ?? existing.schedule_value
      updateData.scheduleType = schedType
      updateData.scheduleValue = schedValue
      updateData.nextRun = this.computeInitialNextRun(schedType, schedValue)
    }

    // If resuming from paused, recompute nextRun
    if (updates.status === 'active' && existing.status === 'paused') {
      const schedType = updates.schedule_type ?? existing.schedule_type
      const schedValue = updates.schedule_value ?? existing.schedule_value
      updateData.nextRun = this.computeInitialNextRun(schedType, schedValue)
    }

    const database = await this.getDatabase()
    await database
      .update(scheduledTasksTable)
      .set(updateData)
      .where(and(eq(scheduledTasksTable.id, taskId), eq(scheduledTasksTable.agentId, agentId)))

    // Sync channel subscriptions if provided
    if (updates.channel_ids !== undefined) {
      await this.syncTaskChannels(taskId, updates.channel_ids)
    }

    logger.info('Task updated', { taskId, agentId })
    return this.getTaskWithChannels(taskId)
  }

  /**
   * Convert a TaskRow (camelCase Drizzle properties) to a ScheduledTaskEntity
   * (snake_case entity properties expected by the rest of the app).
   */
  private rowToEntity(row: TaskRow): ScheduledTaskEntity {
    return {
      id: row.id,
      agent_id: row.agentId,
      name: row.name,
      prompt: row.prompt,
      schedule_type: row.scheduleType as ScheduledTaskEntity['schedule_type'],
      schedule_value: row.scheduleValue,
      timeout_minutes: row.timeoutMinutes,
      next_run: row.nextRun != null ? new Date(row.nextRun).toISOString() : null,
      last_run: row.lastRun != null ? new Date(row.lastRun).toISOString() : null,
      last_result: row.lastResult ?? null,
      status: row.status as ScheduledTaskEntity['status'],
      created_at: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
      updated_at: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
    } as ScheduledTaskEntity
  }

  /**
   * Convert a TaskRunLogRow (camelCase) to a TaskRunLogEntity (snake_case).
   */
  private runLogRowToEntity(row: TaskRunLogRow): TaskRunLogEntity {
    return {
      id: row.id,
      task_id: row.taskId,
      session_id: row.sessionId ?? null,
      run_at: new Date(row.runAt).toISOString(),
      duration_ms: row.durationMs,
      status: row.status as TaskRunLogEntity['status'],
      result: row.result ?? null,
      error: row.error ?? null
    }
  }

  /** Enrich a single task row with its subscribed channel_ids. */
  private async enrichWithChannels(row: TaskRow): Promise<ScheduledTaskEntity> {
    const database = await this.getDatabase()
    const subs = await database
      .select({ channelId: channelTaskSubscriptionsTable.channelId })
      .from(channelTaskSubscriptionsTable)
      .where(eq(channelTaskSubscriptionsTable.taskId, row.id))
    const entity = this.rowToEntity(row)
    return { ...entity, channel_ids: subs.map((s) => s.channelId) } as ScheduledTaskEntity
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
    return rows.map((row) => {
      const entity = this.rowToEntity(row)
      return { ...entity, channel_ids: subsByTask.get(row.id) ?? [] } as ScheduledTaskEntity
    })
  }

  /** Replace all channel subscriptions for a task. */
  private async syncTaskChannels(taskId: string, channelIds: string[]): Promise<void> {
    const database = await this.getDatabase()
    await database.transaction(async (tx) => {
      await tx.delete(channelTaskSubscriptionsTable).where(eq(channelTaskSubscriptionsTable.taskId, taskId))

      if (channelIds.length === 0) return

      const result = await tx
        .insert(channelTaskSubscriptionsTable)
        .values(channelIds.map((channelId) => ({ channelId, taskId })))
        .onConflictDoNothing()

      if (result.rowsAffected !== channelIds.length) {
        // Delete-first means FK violations would have thrown; the only way we
        // land here is duplicate ids in the input list tripping
        // onConflictDoNothing. Tolerated, surfaced for observability.
        logger.warn('syncTaskChannels inserted fewer rows than requested', {
          taskId,
          requested: channelIds.length,
          inserted: result.rowsAffected
        })
      }
    })
  }

  async deleteTask(agentId: string, taskId: string): Promise<boolean> {
    const database = await this.getDatabase()
    const result = await database
      .delete(scheduledTasksTable)
      .where(and(eq(scheduledTasksTable.id, taskId), eq(scheduledTasksTable.agentId, agentId)))

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
    const nowMs = Date.now()
    const database = await this.getDatabase()
    const result = await database
      .select()
      .from(scheduledTasksTable)
      .where(and(eq(scheduledTasksTable.status, 'active'), lte(scheduledTasksTable.nextRun, nowMs)))
      .orderBy(asc(scheduledTasksTable.nextRun))

    return result.map((row) => this.rowToEntity(row))
  }

  async updateTaskAfterRun(taskId: string, nextRun: number | null, lastResult: string): Promise<void> {
    const updateData: Partial<TaskRow> = {
      lastRun: Date.now(),
      lastResult,
      nextRun,
      updatedAt: Date.now()
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
    updates: Partial<Pick<InsertTaskRunLogRow, 'status' | 'result' | 'error' | 'durationMs' | 'sessionId'>>
  ): Promise<void> {
    const database = await this.getDatabase()
    await database.update(taskRunLogsTable).set(updates).where(eq(taskRunLogsTable.id, logId))
  }

  async getTaskLogs(taskId: string, options: ListOptions = {}): Promise<{ logs: TaskRunLogEntity[]; total: number }> {
    const database = await this.getDatabase()

    const totalResult = await database
      .select({ count: count() })
      .from(taskRunLogsTable)
      .where(eq(taskRunLogsTable.taskId, taskId))

    const baseQuery = database
      .select()
      .from(taskRunLogsTable)
      .where(eq(taskRunLogsTable.taskId, taskId))
      .orderBy(desc(taskRunLogsTable.runAt))

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    return {
      logs: result.map((row) => this.runLogRowToEntity(row)),
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
      .select({ sessionId: taskRunLogsTable.sessionId })
      .from(taskRunLogsTable)
      .where(and(eq(taskRunLogsTable.taskId, taskId), eq(taskRunLogsTable.status, 'success')))
      .orderBy(desc(taskRunLogsTable.runAt))
      .limit(1)

    return result[0]?.sessionId ?? null
  }

  // --- Next run computation (nanoclaw-inspired, drift-resistant) ---

  computeNextRun(task: ScheduledTaskEntity): number | null {
    if (task.schedule_type === 'once') return null

    const now = Date.now()

    if (task.schedule_type === 'cron') {
      try {
        const interval = CronExpressionParser.parse(task.schedule_value)
        return interval.next().getTime()
      } catch (error) {
        logger.warn('Invalid cron expression', {
          taskId: task.id,
          cron: task.schedule_value,
          error: error instanceof Error ? error.message : String(error)
        })
        return null
      }
    }

    if (task.schedule_type === 'interval') {
      const minutes = parseInt(task.schedule_value, 10)
      const ms = minutes * 60_000
      if (!ms || ms <= 0) {
        logger.warn('Invalid interval value', { taskId: task.id, value: task.schedule_value })
        return now + 60_000
      }

      // Anchor to scheduled time to prevent drift
      let next = new Date(task.next_run!).getTime() + ms
      while (next <= now) {
        next += ms
      }
      return next
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
      } catch (error) {
        throw new Error(
          `Agent ${agentId} has a malformed configuration JSON and cannot be scheduled: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }

    if (config.soul_enabled === true || config.permission_mode === 'bypassPermissions') {
      return
    }

    throw new Error('Scheduled tasks require Soul Mode or Bypass Permissions mode. Update the agent settings first.')
  }

  private computeInitialNextRun(scheduleType: string, scheduleValue: string): number | null {
    const now = Date.now()

    switch (scheduleType) {
      case 'cron': {
        try {
          const interval = CronExpressionParser.parse(scheduleValue)
          return interval.next().getTime()
        } catch (error) {
          logger.warn('Invalid cron expression for initial next-run computation', {
            scheduleValue,
            error: error instanceof Error ? error.message : String(error)
          })
          return null
        }
      }
      case 'interval': {
        const minutes = parseInt(scheduleValue, 10)
        if (!minutes || minutes <= 0) return null
        return now + minutes * 60_000
      }
      case 'once': {
        // schedule_value is an ISO timestamp for once
        const parsed = Date.parse(scheduleValue)
        return Number.isNaN(parsed) ? null : parsed
      }
      default:
        return null
    }
  }
}

export const taskService = new TaskService()
