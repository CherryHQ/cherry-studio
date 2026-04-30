import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable, agentChannelTaskTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { agentTaskRunLogTable, agentTaskTable } from '@data/db/schemas/agentTask'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

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

const logger = loggerService.withContext('AgentsMigrator')

/** Remap old prefix IDs and hardcoded builtin IDs to UUID v4, updating all FK references.
 *  Manages its own PRAGMA foreign_keys = OFF + transaction. Idempotent. */
export async function remapAgentPrefixIds(db: MigrationContext['db']): Promise<void> {
  // PRAGMA foreign_keys cannot be changed inside a transaction; set it before.
  // libsql creates a fresh connection per transaction() — must re-set before each call.
  await db.run(sql`PRAGMA foreign_keys = OFF`)
  try {
    await db.transaction(async (tx) => {
      const oldAgents = await tx
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(
          sql`${agentTable.id} GLOB 'agent_*' OR ${agentTable.id} = 'cherry-claw-default' OR ${agentTable.id} = 'cherry-assistant-default'`
        )

      for (const { id: oldId } of oldAgents) {
        const newId = uuidv4()
        await tx.update(agentTable).set({ id: newId }).where(eq(agentTable.id, oldId))
        await tx.update(agentSessionTable).set({ agentId: newId }).where(eq(agentSessionTable.agentId, oldId))
        await tx.update(agentSkillTable).set({ agentId: newId }).where(eq(agentSkillTable.agentId, oldId))
        await tx.update(agentTaskTable).set({ agentId: newId }).where(eq(agentTaskTable.agentId, oldId))
        await tx.update(agentChannelTable).set({ agentId: newId }).where(eq(agentChannelTable.agentId, oldId))
      }

      const oldSessions = await tx
        .select({ id: agentSessionTable.id })
        .from(agentSessionTable)
        .where(sql`${agentSessionTable.id} GLOB 'session_*'`)

      for (const { id: oldId } of oldSessions) {
        const newId = uuidv4()
        await tx.update(agentSessionTable).set({ id: newId }).where(eq(agentSessionTable.id, oldId))
        await tx
          .update(agentSessionMessageTable)
          .set({ sessionId: newId })
          .where(eq(agentSessionMessageTable.sessionId, oldId))
        await tx.update(agentChannelTable).set({ sessionId: newId }).where(eq(agentChannelTable.sessionId, oldId))
        await tx.update(agentTaskRunLogTable).set({ sessionId: newId }).where(eq(agentTaskRunLogTable.sessionId, oldId))
      }

      const oldTasks = await tx
        .select({ id: agentTaskTable.id })
        .from(agentTaskTable)
        .where(sql`${agentTaskTable.id} GLOB 'task_*'`)

      for (const { id: oldId } of oldTasks) {
        const newId = uuidv4()
        await tx.update(agentTaskTable).set({ id: newId }).where(eq(agentTaskTable.id, oldId))
        await tx.update(agentTaskRunLogTable).set({ taskId: newId }).where(eq(agentTaskRunLogTable.taskId, oldId))
        await tx.update(agentChannelTaskTable).set({ taskId: newId }).where(eq(agentChannelTaskTable.taskId, oldId))
      }
    })
  } finally {
    await db.run(sql`PRAGMA foreign_keys = ON`)
  }
}

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

      // Remap old prefix IDs to UUID v4 after the import commits.
      // remapAgentPrefixIds manages its own PRAGMA FK OFF + transaction.
      await remapAgentPrefixIds(ctx.db)
    } catch (error) {
      if (!committed) {
        try {
          await ctx.db.run(sql.raw('ROLLBACK'))
        } catch (rollbackError) {
          logger.warn('ROLLBACK failed after migration error', rollbackError as Error)
        }
      }
      logger.error('Agents migration execute failed:', error as Error)
      throw error
    } finally {
      try {
        await ctx.db.run(sql.raw('PRAGMA foreign_keys = ON'))
      } catch (pragmaError) {
        logger.warn('Failed to re-enable foreign_keys after agents migration', pragmaError as Error)
      }
      if (isAttached) {
        try {
          await ctx.db.run(sql.raw('DETACH DATABASE agents_legacy'))
        } catch (detachError) {
          // DETACH must not mask the original error; just log it so it surfaces in diagnostics.
          logger.warn('Failed to DETACH agents_legacy database', detachError as Error)
        }
      }
    }

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
        const targetResult = await ctx.db.get<{ count: number }>(
          sql.raw(`SELECT COUNT(*) AS count FROM ${spec.targetTable}`)
        )
        const tableTargetCount = Number(targetResult?.count ?? 0)
        const tableSourceCount = this.sourceCounts[spec.sourceTable]
        const expectedResult = await ctx.db.get<{ count: number }>(
          sql.raw(
            `SELECT COUNT(*) AS count FROM agents_legacy.${spec.sourceTable}${spec.whereClause ? ` WHERE ${spec.whereClause}` : ''}`
          )
        )
        const tableExpectedCount = Number(expectedResult?.count ?? 0)
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
        logger.warn('Failed to DETACH agents_legacy database during validation', detachError as Error)
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
