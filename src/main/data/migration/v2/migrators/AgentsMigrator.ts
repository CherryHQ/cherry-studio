import { agentChannelTaskTable } from '@data/db/schemas/agentChannel'
import { jobScheduleTable } from '@data/db/schemas/job'
import { loggerService } from '@logger'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { LegacyAgentsDbReader } from '../utils/LegacyAgentsDbReader'
import { BaseMigrator } from './BaseMigrator'
import {
  AGENTS_TABLE_MIGRATION_SPECS,
  type AgentsSchemaInfo,
  type AgentsTableRowCounts,
  buildAgentsImportStatements,
  createEmptyAgentsSchemaInfo,
  getTotalAgentsRowCount,
  quoteSqlitePath
} from './mappings/AgentsDbMappings'
import { remapAgentPrefixIds } from './remapAgentPrefixIds'

type V1ScheduledTaskRow = {
  id: string
  agent_id: string
  name: string | null
  prompt: string
  schedule_type: string
  schedule_value: string
  timeout_minutes: number | null
  status: string
}

type V1ChannelTaskSubscription = {
  channel_id: string
  task_id: string
}

const HEARTBEAT_INTERVAL_FALLBACK_MS = 60 * 60_000

const logger = loggerService.withContext('AgentsMigrator')

export class AgentsMigrator extends BaseMigrator {
  readonly id = 'agents'
  readonly name = 'Agents'
  readonly description = 'Migrate legacy agents.db data into the main SQLite database'
  readonly order = 2.5

  private sourceCounts: AgentsTableRowCounts = this.createEmptyCounts()
  private sourceDbPath: string | null | undefined = undefined
  private sourceSchemaInfo: AgentsSchemaInfo = createEmptyAgentsSchemaInfo()
  private reader: LegacyAgentsDbReader | null = null

  override reset(): void {
    this.sourceCounts = this.createEmptyCounts()
    this.sourceDbPath = undefined
    this.sourceSchemaInfo = createEmptyAgentsSchemaInfo()
    this.reader = null
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    const reader = this.createReader(ctx)
    const dbPath = this.resolveSourceDbPath(reader)

    if (!dbPath) {
      logger.info('No legacy agents.db found at prepare phase')
      return {
        success: true,
        itemCount: 0,
        warnings: ['agents.db not found - no agents data to migrate']
      }
    }

    this.sourceSchemaInfo = await reader.inspectSchema()
    this.sourceCounts = await reader.countRows(this.sourceSchemaInfo)

    // Debug: Log schema detection results
    logger.info('AgentsMigrator prepare:', {
      dbPath,
      tablesDetected: Object.entries(this.sourceSchemaInfo)
        .filter(([, v]) => v.exists)
        .map(([k]) => k),
      rowCounts: this.sourceCounts,
      totalRows: getTotalAgentsRowCount(this.sourceCounts)
    })

    return {
      success: true,
      itemCount: getTotalAgentsRowCount(this.sourceCounts)
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    const reader = this.createReader(ctx)
    const dbPath = this.resolveSourceDbPath(reader)

    if (!dbPath) {
      logger.info('No legacy agents.db found, skipping agents migration')
      return { success: true, processedCount: 0 }
    }

    if (getTotalAgentsRowCount(this.sourceCounts) === 0) {
      this.sourceSchemaInfo = await reader.inspectSchema()
      this.sourceCounts = await reader.countRows(this.sourceSchemaInfo)
    }

    // Debug logging: show source schema detection and counts
    logger.info('Source schema detected:', {
      dbPath,
      tableExists: Object.fromEntries(Object.entries(this.sourceSchemaInfo).map(([k, v]) => [k, v.exists])),
      sourceCounts: this.sourceCounts
    })

    const statements = buildAgentsImportStatements(dbPath, this.sourceSchemaInfo)

    logger.debug('Generated SQL statements:', {
      statementCount: statements.length,
      statements: statements.map((s, i) => ({ index: i, sql: s.substring(0, 200) }))
    })

    // ATTACH/DETACH cannot live inside a transaction, and libsql creates a
    // fresh connection per transaction() call — meaning agents_legacy would
    // not be visible inside db.transaction(). Use manual BEGIN/COMMIT/ROLLBACK
    // via db.run() so ATTACH, all INSERTs, and DETACH share the same connection.
    const importStatements = statements.slice(1, -1)
    let isAttached = false
    let committed = false
    let pendingError: unknown = null

    try {
      await ctx.db.run(sql.raw(statements[0])) // ATTACH DATABASE …
      isAttached = true
      await ctx.db.run(sql.raw('PRAGMA foreign_keys = OFF'))
      await ctx.db.run(sql.raw('BEGIN'))

      for (const statement of importStatements) {
        logger.debug('Executing SQL:', { sql: statement.substring(0, 200) })
        await ctx.db.run(sql.raw(statement))
      }

      await ctx.db.run(sql.raw('COMMIT'))
      committed = true
      logger.info('Agents migration transaction committed successfully')

      // v1 scheduled_tasks → v2 job_schedule + agent_channel_task. Runs while
      // agents_legacy is still attached so the reads can target it directly via
      // ctx.db. Must happen BEFORE remapAgentPrefixIds — schedules carry the
      // legacy agent_id inside their jobInputTemplate JSON, and the remap step
      // is responsible for rewriting both `agent.id` AND
      // `job_schedule.jobInputTemplate.agentId` together.
      await this.migrateScheduledTasksTs(ctx.db)

      // Remap old prefix IDs after the import transaction commits. Must run after COMMIT
      // so the imported rows are visible; remapAgentPrefixIds is idempotent, so a retry
      // after a previous partial failure is safe.
      await remapAgentPrefixIds(ctx.db)
    } catch (error) {
      if (!committed) {
        try {
          await ctx.db.run(sql.raw('ROLLBACK'))
        } catch (rollbackError) {
          logger.error(
            'ROLLBACK failed after agents migration error — DB may be in an inconsistent state',
            rollbackError as Error
          )
        }
      }
      logger.error('Agents migration execute failed:', error as Error)
      pendingError = error
    }

    // FK re-enable must succeed: a silent failure leaves the rest of the migration
    // pipeline (and the app) running with FK enforcement off, which masks
    // referential corruption. Only overwrite pendingError if the main path succeeded —
    // otherwise the original failure is more informative.
    try {
      await ctx.db.run(sql.raw('PRAGMA foreign_keys = ON'))
    } catch (pragmaError) {
      logger.error('Failed to re-enable foreign_keys after agents migration — aborting', pragmaError as Error)
      if (!pendingError) pendingError = pragmaError
    }

    if (isAttached) {
      try {
        await ctx.db.run(sql.raw('DETACH DATABASE agents_legacy'))
      } catch (detachError) {
        // DETACH must not mask the original error; log loudly so it surfaces in diagnostics.
        logger.error('Failed to DETACH agents_legacy database', detachError as Error)
      }
    }

    if (pendingError) throw pendingError

    return {
      success: true,
      processedCount: getTotalAgentsRowCount(this.sourceCounts)
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    const reader = this.createReader(ctx)
    const dbPath = this.resolveSourceDbPath(reader)

    if (!dbPath) {
      return {
        success: true,
        errors: [],
        stats: {
          sourceCount: 0,
          targetCount: 0,
          skippedCount: 0
        }
      }
    }

    if (getTotalAgentsRowCount(this.sourceCounts) === 0) {
      this.sourceSchemaInfo = await reader.inspectSchema()
      this.sourceCounts = await reader.countRows(this.sourceSchemaInfo)
    }

    const errors: ValidationError[] = []
    let targetCount = 0
    let skippedCount = 0
    const validationDetails: Array<{
      table: string
      source: number
      expected: number
      target: number
      filtered: boolean
      ok: boolean
    }> = []

    await ctx.db.run(sql.raw(`ATTACH DATABASE ${quoteSqlitePath(dbPath)} AS agents_legacy`))

    try {
      for (const spec of AGENTS_TABLE_MIGRATION_SPECS) {
        // Mirror the execute-side guard in buildAgentsImportStatements: legacy DBs
        // from older app versions may lack tables added later (e.g. agent_skills).
        if (!this.sourceSchemaInfo[spec.sourceTable].exists) {
          continue
        }

        // .get() with sql.raw() crashes on zero rows in drizzle-orm/libsql; use .all() instead.
        const targetRows = await ctx.db.all<{ count: number }>(
          sql.raw(`SELECT COUNT(*) AS count FROM ${spec.targetTable}`)
        )
        const tableTargetCount = Number(targetRows[0]?.count ?? 0)
        const tableSourceCount = this.sourceCounts[spec.sourceTable]
        const validateWhere = spec.validateWhereClause ?? spec.whereClause
        const expectedRows = await ctx.db.all<{ count: number }>(
          sql.raw(
            `SELECT COUNT(*) AS count FROM agents_legacy.${spec.sourceTable}${validateWhere ? ` WHERE ${validateWhere}` : ''}`
          )
        )
        const tableExpectedCount = Number(expectedRows[0]?.count ?? 0)
        targetCount += tableTargetCount

        const hasWhereClause = !!spec.whereClause
        const tableSkippedCount = Math.max(0, tableSourceCount - tableExpectedCount)
        skippedCount += tableSkippedCount
        const ok = tableTargetCount === tableExpectedCount

        validationDetails.push({
          table: spec.targetTable,
          source: tableSourceCount,
          expected: tableExpectedCount,
          target: tableTargetCount,
          filtered: hasWhereClause,
          ok
        })

        if (!ok) {
          const direction = tableTargetCount < tableExpectedCount ? 'too low' : 'too high'
          errors.push({
            key: `${spec.targetTable}_count_mismatch`,
            expected: tableExpectedCount,
            actual: tableTargetCount,
            message: `${spec.targetTable} count ${direction}: expected ${tableExpectedCount}, got ${tableTargetCount}`
          })
        }
      }
    } finally {
      try {
        await ctx.db.run(sql.raw('DETACH DATABASE agents_legacy'))
      } catch (detachError) {
        logger.error('Failed to DETACH agents_legacy database during validation', detachError as Error)
      }
    }

    logger.info('AgentsMigrator validation:', {
      validationDetails,
      errorCount: errors.length,
      totalSkipped: skippedCount
    })

    return {
      success: errors.length === 0,
      errors,
      stats: {
        sourceCount: getTotalAgentsRowCount(this.sourceCounts),
        targetCount,
        skippedCount,
        mismatchReason: errors.length > 0 ? 'One or more agent_* tables did not match expected row counts' : undefined
      }
    }
  }

  /**
   * Migrate v1 `scheduled_tasks` + `channel_task_subscriptions` into v2
   * `job_schedule` + `agent_channel_task`. v1 `task_run_logs` are intentionally
   * discarded — see breaking-changes/2026-05-19-agent-task-migration.md.
   *
   * Runs after the legacy DB has been ATTACHed by `execute()` so all reads
   * target `agents_legacy.*` directly via the connection that owns the ATTACH.
   */
  private async migrateScheduledTasksTs(db: MigrationContext['db']): Promise<void> {
    // Idempotency on retry: drop any partial agent.task schedules from a
    // previous failed run so the (type, name) UNIQUE index doesn't reject the
    // second-pass inserts. Other type rows (e.g. file processing) are
    // untouched.
    await db.delete(jobScheduleTable).where(sql`${jobScheduleTable.type} = 'agent.task'`)

    const v1Tasks = await db.all<V1ScheduledTaskRow>(
      sql.raw(
        'SELECT id, agent_id, name, prompt, schedule_type, schedule_value, timeout_minutes, status ' +
          'FROM agents_legacy.scheduled_tasks ' +
          'WHERE agent_id IN (SELECT id FROM agent)'
      )
    )

    const idMap = new Map<string, string>()
    let migratedCount = 0
    let droppedNameCount = 0

    for (const v1 of v1Tasks) {
      const trigger = this.buildTriggerFromV1(v1)
      if (!trigger) {
        logger.warn('Skipping v1 task with unparseable schedule', {
          v1Id: v1.id,
          type: v1.schedule_type,
          value: v1.schedule_value
        })
        continue
      }

      // v1 enforced `name NOT NULL` but allowed whitespace / control chars that
      // JobScheduleNameAtomSchema rejects on the application boundary. The
      // migrator writes raw into the row (bypasses Zod), but a future
      // `JobManager.updateJobSchedule` on the row would fail validation. Sanitize
      // here so v2 reads are well-formed end-to-end.
      const rawName = v1.name?.trim() ?? ''
      const sanitizedName =
        rawName && !rawName.startsWith('__') && !this.hasControlChars(rawName)
          ? rawName.slice(0, 200)
          : `task_${v1.id}`.slice(0, 200)
      if (sanitizedName !== rawName) droppedNameCount++

      const inserted = await db
        .insert(jobScheduleTable)
        .values({
          type: 'agent.task',
          name: sanitizedName,
          trigger,
          jobInputTemplate: {
            agentId: v1.agent_id,
            prompt: v1.prompt,
            timeoutMinutes: v1.timeout_minutes ?? 2
          },
          catchUpPolicy: { kind: 'skip-missed' },
          enabled: v1.status === 'active',
          metadata: { migratedFrom: 'v1.agentTask', v1Id: v1.id }
        })
        .returning({ id: jobScheduleTable.id })

      const newId = inserted[0]?.id
      if (!newId) {
        logger.error('Insert of job_schedule did not return an id', undefined, { v1Id: v1.id })
        continue
      }
      idMap.set(v1.id, newId)
      migratedCount++
    }

    const v1Subs = await db.all<V1ChannelTaskSubscription>(
      sql.raw(
        'SELECT channel_id, task_id FROM agents_legacy.channel_task_subscriptions ' +
          'WHERE channel_id IN (SELECT id FROM agent_channel) ' +
          'AND task_id IN (SELECT id FROM agents_legacy.scheduled_tasks WHERE agent_id IN (SELECT id FROM agent))'
      )
    )

    let subCount = 0
    for (const sub of v1Subs) {
      const newScheduleId = idMap.get(sub.task_id)
      if (!newScheduleId) continue
      await db
        .insert(agentChannelTaskTable)
        .values({ channelId: sub.channel_id, taskId: newScheduleId })
        .onConflictDoNothing()
      subCount++
    }

    logger.info('Scheduled tasks migrated', {
      schedules: migratedCount,
      channelLinks: subCount,
      sanitizedNames: droppedNameCount
    })
  }

  private buildTriggerFromV1(v1: V1ScheduledTaskRow): Trigger | null {
    if (v1.schedule_type === 'cron') {
      if (!v1.schedule_value.trim()) return null
      return { kind: 'cron', expr: v1.schedule_value.trim() }
    }
    if (v1.schedule_type === 'interval') {
      const minutes = parseInt(v1.schedule_value, 10)
      if (!Number.isFinite(minutes) || minutes <= 0) {
        // Heartbeat tasks used to store interval=30 in legacy; fall back to a
        // safe default rather than dropping the row.
        return { kind: 'interval', ms: HEARTBEAT_INTERVAL_FALLBACK_MS }
      }
      return { kind: 'interval', ms: minutes * 60_000 }
    }
    if (v1.schedule_type === 'once') {
      const at = Date.parse(v1.schedule_value)
      if (!Number.isFinite(at)) return null
      return { kind: 'once', at }
    }
    return null
  }

  private hasControlChars(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i)
      if (code === 0 || code === 9 || code === 10 || code === 13) return true
    }
    return false
  }

  private createReader(ctx: MigrationContext): LegacyAgentsDbReader {
    return (this.reader ??= new LegacyAgentsDbReader(ctx.paths))
  }

  private resolveSourceDbPath(reader: LegacyAgentsDbReader): string | null {
    if (this.sourceDbPath !== undefined) {
      return this.sourceDbPath
    }

    this.sourceDbPath = reader.resolvePath()
    return this.sourceDbPath
  }

  private createEmptyCounts(): AgentsTableRowCounts {
    return {
      agents: 0,
      sessions: 0,
      skills: 0,
      agent_skills: 0,
      scheduled_tasks: 0,
      task_run_logs: 0,
      channels: 0,
      channel_task_subscriptions: 0,
      session_messages: 0
    }
  }
}
