import { application } from '@application'
import { agentTable as agentsTable } from '@data/db/schemas/agent'
import { agentChannelTaskTable as channelTaskSubscriptionsTable } from '@data/db/schemas/agentChannel'
import {
  type AgentTaskRow as TaskRow,
  type AgentTaskRunLogRow as TaskRunLogRow,
  agentTaskRunLogTable as taskRunLogsTable,
  agentTaskTable as scheduledTasksTable,
  type InsertAgentTaskRow as InsertTaskRow,
  type InsertAgentTaskRunLogRow as InsertTaskRunLogRow
} from '@data/db/schemas/agentTask'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { nullsToUndefined, timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import {
  type CreateTaskDto,
  type ScheduledTaskEntity,
  type TaskRunLogEntity,
  type UpdateTaskDto
} from '@shared/data/api/schemas/agents'
import type { ListOptions } from '@types'
import { CronExpressionParser } from 'cron-parser'
import { and, asc, count, desc, eq, inArray, lte, ne } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('TaskService')

export class AgentTaskService {
  async createTask(agentId: string, req: CreateTaskDto): Promise<ScheduledTaskEntity> {
    await this.assertAutonomous(agentId)

    const id = uuidv4()

    const nextRun = this.computeInitialNextRun(req.scheduleType, req.scheduleValue)

    const insertData: InsertTaskRow = {
      id,
      agentId,
      name: req.name,
      prompt: req.prompt,
      scheduleType: req.scheduleType,
      scheduleValue: req.scheduleValue,
      ...(req.timeoutMinutes != null ? { timeoutMinutes: req.timeoutMinutes } : {}),
      nextRun,
      status: 'active'
    }

    const database = application.get('DbService').getDb()
    await withSqliteErrors(
      () =>
        database.transaction(async (tx) => {
          const result = await tx.insert(scheduledTasksTable).values(insertData)
          if (result.rowsAffected !== 1) {
            throw DataApiErrorFactory.invalidOperation('insert task', `rowsAffected=${result.rowsAffected}`)
          }

          if (req.channelIds?.length) {
            await tx
              .insert(channelTaskSubscriptionsTable)
              .values(req.channelIds.map((channelId) => ({ channelId, taskId: id })))
              .onConflictDoNothing()
          }
        }),
      {
        ...defaultHandlersFor('Task', id),
        foreignKey: () =>
          DataApiErrorFactory.invalidOperation('create task', 'referenced agent or channel does not exist')
      }
    )

    logger.info('Task created', { taskId: id, agentId })
    return this.getTaskWithChannels(id)
  }

  /** Fetch a task row enriched with its subscribed channel_ids. */
  private async getTaskWithChannels(taskId: string): Promise<ScheduledTaskEntity> {
    const database = application.get('DbService').getDb()
    const result = await database.select().from(scheduledTasksTable).where(eq(scheduledTasksTable.id, taskId)).limit(1)
    if (!result[0]) throw DataApiErrorFactory.notFound('Task', taskId)
    return this.enrichWithChannels(result[0])
  }

  async getTask(agentId: string, taskId: string): Promise<ScheduledTaskEntity | null> {
    const database = application.get('DbService').getDb()
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
    const database = application.get('DbService').getDb()
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
    const database = application.get('DbService').getDb()
    const result = await database.select().from(scheduledTasksTable).where(eq(scheduledTasksTable.id, taskId)).limit(1)

    if (!result[0]) return null
    return this.enrichWithChannels(result[0])
  }

  async updateTaskById(taskId: string, updates: UpdateTaskDto): Promise<ScheduledTaskEntity | null> {
    const existing = await this.getTaskById(taskId)
    if (!existing) return null

    const updateData: Partial<TaskRow> = { updatedAt: Date.now() }

    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.prompt !== undefined) updateData.prompt = updates.prompt
    if (updates.timeoutMinutes !== undefined) updateData.timeoutMinutes = updates.timeoutMinutes ?? 2
    if (updates.status !== undefined) updateData.status = updates.status

    if (updates.scheduleType !== undefined || updates.scheduleValue !== undefined) {
      const schedType = updates.scheduleType ?? existing.scheduleType
      const schedValue = updates.scheduleValue ?? existing.scheduleValue
      updateData.scheduleType = schedType
      updateData.scheduleValue = schedValue
      updateData.nextRun = this.computeInitialNextRun(schedType, schedValue)
    }

    if (updates.status === 'active' && existing.status === 'paused') {
      const schedType = updates.scheduleType ?? existing.scheduleType
      const schedValue = updates.scheduleValue ?? existing.scheduleValue
      updateData.nextRun = this.computeInitialNextRun(schedType, schedValue)
    }

    const database = application.get('DbService').getDb()
    await withSqliteErrors(
      () =>
        database.transaction(async (tx) => {
          await tx.update(scheduledTasksTable).set(updateData).where(eq(scheduledTasksTable.id, taskId))
          if (updates.channelIds !== undefined) {
            await tx.delete(channelTaskSubscriptionsTable).where(eq(channelTaskSubscriptionsTable.taskId, taskId))
            if (updates.channelIds.length > 0) {
              const result = await tx
                .insert(channelTaskSubscriptionsTable)
                .values(updates.channelIds.map((channelId) => ({ channelId, taskId })))
                .onConflictDoNothing()
              if (result.rowsAffected !== updates.channelIds.length) {
                logger.warn('updateTaskById: inserted fewer channel rows than requested', {
                  taskId,
                  requested: updates.channelIds.length,
                  inserted: result.rowsAffected
                })
              }
            }
          }
        }),
      defaultHandlersFor('Task', taskId)
    )

    logger.info('Task updated', { taskId })
    return this.getTaskWithChannels(taskId)
  }

  async deleteTaskById(taskId: string): Promise<boolean> {
    const database = application.get('DbService').getDb()
    const result = await database.delete(scheduledTasksTable).where(eq(scheduledTasksTable.id, taskId))

    logger.info('Task deleted', { taskId })
    return result.rowsAffected > 0
  }

  async listAllTasks(options: ListOptions = {}): Promise<{ tasks: ScheduledTaskEntity[]; total: number }> {
    const database = application.get('DbService').getDb()
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

  async updateTask(agentId: string, taskId: string, updates: UpdateTaskDto): Promise<ScheduledTaskEntity | null> {
    const existing = await this.getTask(agentId, taskId)
    if (!existing) return null

    const updateData: Partial<TaskRow> = { updatedAt: Date.now() }

    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.prompt !== undefined) updateData.prompt = updates.prompt
    if (updates.timeoutMinutes !== undefined) updateData.timeoutMinutes = updates.timeoutMinutes ?? 2
    if (updates.status !== undefined) updateData.status = updates.status

    // If schedule type or value changed, recompute nextRun
    if (updates.scheduleType !== undefined || updates.scheduleValue !== undefined) {
      const schedType = updates.scheduleType ?? existing.scheduleType
      const schedValue = updates.scheduleValue ?? existing.scheduleValue
      updateData.scheduleType = schedType
      updateData.scheduleValue = schedValue
      updateData.nextRun = this.computeInitialNextRun(schedType, schedValue)
    }

    // If resuming from paused, recompute nextRun
    if (updates.status === 'active' && existing.status === 'paused') {
      const schedType = updates.scheduleType ?? existing.scheduleType
      const schedValue = updates.scheduleValue ?? existing.scheduleValue
      updateData.nextRun = this.computeInitialNextRun(schedType, schedValue)
    }

    const database = application.get('DbService').getDb()
    await withSqliteErrors(
      () =>
        database.transaction(async (tx) => {
          await tx
            .update(scheduledTasksTable)
            .set(updateData)
            .where(and(eq(scheduledTasksTable.id, taskId), eq(scheduledTasksTable.agentId, agentId)))
          if (updates.channelIds !== undefined) {
            await tx.delete(channelTaskSubscriptionsTable).where(eq(channelTaskSubscriptionsTable.taskId, taskId))
            if (updates.channelIds.length > 0) {
              const result = await tx
                .insert(channelTaskSubscriptionsTable)
                .values(updates.channelIds.map((channelId) => ({ channelId, taskId })))
                .onConflictDoNothing()
              if (result.rowsAffected !== updates.channelIds.length) {
                logger.warn('updateTask: inserted fewer channel rows than requested', {
                  taskId,
                  agentId,
                  requested: updates.channelIds.length,
                  inserted: result.rowsAffected
                })
              }
            }
          }
        }),
      defaultHandlersFor('Task', taskId)
    )

    logger.info('Task updated', { taskId, agentId })
    return this.getTaskWithChannels(taskId)
  }

  private rowToEntity(row: TaskRow): ScheduledTaskEntity {
    const clean = nullsToUndefined(row)
    return {
      ...clean,
      scheduleType: row.scheduleType as ScheduledTaskEntity['scheduleType'],
      status: row.status as ScheduledTaskEntity['status'],
      // Preserve T|null contract for nullable timestamp columns
      nextRun: row.nextRun != null ? timestampToISO(row.nextRun) : null,
      lastRun: row.lastRun != null ? timestampToISO(row.lastRun) : null,
      lastResult: row.lastResult ?? null,
      createdAt: timestampToISO(row.createdAt),
      updatedAt: timestampToISO(row.updatedAt)
    } as ScheduledTaskEntity
  }

  private runLogRowToEntity(row: TaskRunLogRow): TaskRunLogEntity {
    const clean = nullsToUndefined(row)
    return {
      ...clean,
      runAt: new Date(row.runAt).toISOString(),
      status: row.status as TaskRunLogEntity['status'],
      // Preserve T|null contract
      sessionId: row.sessionId ?? null,
      result: row.result ?? null,
      error: row.error ?? null
    }
  }

  /** Enrich a single task row with its subscribed channel_ids. */
  private async enrichWithChannels(row: TaskRow): Promise<ScheduledTaskEntity> {
    const database = application.get('DbService').getDb()
    const subs = await database
      .select({ channelId: channelTaskSubscriptionsTable.channelId })
      .from(channelTaskSubscriptionsTable)
      .where(eq(channelTaskSubscriptionsTable.taskId, row.id))
    const entity = this.rowToEntity(row)
    return { ...entity, channelIds: subs.map((s) => s.channelId) } as ScheduledTaskEntity
  }

  /** Enrich multiple task rows with their subscribed channel_ids (batched). */
  private async enrichManyWithChannels(rows: TaskRow[]): Promise<ScheduledTaskEntity[]> {
    if (rows.length === 0) return []
    const database = application.get('DbService').getDb()
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
      return { ...entity, channelIds: subsByTask.get(row.id) ?? [] } as ScheduledTaskEntity
    })
  }

  async deleteTask(agentId: string, taskId: string): Promise<boolean> {
    const database = application.get('DbService').getDb()
    const result = await database
      .delete(scheduledTasksTable)
      .where(and(eq(scheduledTasksTable.id, taskId), eq(scheduledTasksTable.agentId, agentId)))

    logger.info('Task deleted', { taskId, agentId })
    return result.rowsAffected > 0
  }

  // --- Due tasks (used by SchedulerService poll loop) ---

  async hasActiveTasks(): Promise<boolean> {
    const database = application.get('DbService').getDb()
    const [result] = await database
      .select({ count: count() })
      .from(scheduledTasksTable)
      .where(eq(scheduledTasksTable.status, 'active'))
    return (result?.count ?? 0) > 0
  }

  async getDueTasks(): Promise<ScheduledTaskEntity[]> {
    const nowMs = Date.now()
    const database = application.get('DbService').getDb()
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

    if (nextRun === null) {
      updateData.status = 'completed'
    }

    const database = application.get('DbService').getDb()
    try {
      await database.update(scheduledTasksTable).set(updateData).where(eq(scheduledTasksTable.id, taskId))
    } catch (error) {
      logger.error('updateTaskAfterRun failed; advancing nextRun to prevent scheduler hot-loop', { taskId, error })
      // Best-effort: advance nextRun so the task is not re-scheduled immediately.
      try {
        await database
          .update(scheduledTasksTable)
          .set({ nextRun: Date.now() + 60_000, updatedAt: Date.now() })
          .where(eq(scheduledTasksTable.id, taskId))
      } catch (fallbackError) {
        logger.error('updateTaskAfterRun fallback also failed', { taskId, fallbackError })
      }
    }
  }

  // --- Task run logs ---

  async logTaskRun(log: Omit<InsertTaskRunLogRow, 'id'>): Promise<number> {
    const database = application.get('DbService').getDb()
    const result = await database.insert(taskRunLogsTable).values(log).returning({ id: taskRunLogsTable.id })
    return result[0].id
  }

  async updateTaskRunLog(
    logId: number,
    updates: Partial<Pick<InsertTaskRunLogRow, 'status' | 'result' | 'error' | 'durationMs' | 'sessionId'>>
  ): Promise<void> {
    const database = application.get('DbService').getDb()
    await database.update(taskRunLogsTable).set(updates).where(eq(taskRunLogsTable.id, logId))
  }

  async getTaskLogs(taskId: string, options: ListOptions = {}): Promise<{ logs: TaskRunLogEntity[]; total: number }> {
    const database = application.get('DbService').getDb()

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
    const database = application.get('DbService').getDb()
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
    if (task.scheduleType === 'once') return null

    const now = Date.now()

    if (task.scheduleType === 'cron') {
      try {
        const interval = CronExpressionParser.parse(task.scheduleValue)
        return interval.next().getTime()
      } catch (error) {
        logger.warn('Invalid cron expression', {
          taskId: task.id,
          cron: task.scheduleValue,
          error: error instanceof Error ? error.message : String(error)
        })
        return null
      }
    }

    if (task.scheduleType === 'interval') {
      const minutes = parseInt(task.scheduleValue, 10)
      const ms = minutes * 60_000
      if (!ms || ms <= 0) {
        logger.warn('Invalid interval value', { taskId: task.id, value: task.scheduleValue })
        return now + 60_000
      }

      // Anchor to scheduled time to prevent drift; fall back to now when nextRun is null (e.g. failed cron parse)
      if (task.nextRun == null) return now + ms
      let next = new Date(task.nextRun).getTime() + ms
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
    const database = application.get('DbService').getDb()
    const [row] = await database
      .select({ configuration: agentsTable.configuration })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Agent', agentId)
    }

    const config: Record<string, unknown> = row.configuration ?? {}

    if (config.soul_enabled === true || config.permission_mode === 'bypassPermissions') {
      return
    }

    throw DataApiErrorFactory.invalidOperation(
      'Scheduled tasks require Soul Mode or Bypass Permissions mode. Update the agent settings first.'
    )
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

export const agentTaskService = new AgentTaskService()
