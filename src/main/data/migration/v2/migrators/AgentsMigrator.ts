import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import type { DbType } from '@data/db/types'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { asc, eq, sql } from 'drizzle-orm'

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
import { normalizeStatus, transformBlocksToParts } from './mappings/ChatMappings'
import { remapAgentPrefixIds } from './remapAgentPrefixIds'

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

      // Atomic post-INSERT shape reconciliation — runs INSIDE the BEGIN/COMMIT
      // so a failure rolls everything back instead of leaving rows in an
      // intermediate sentinel state (`order_key=''` or v1 `blocks: [...]`).
      //
      // Order:
      //   1. backfillAgentOrderKeys — joins `agents_legacy.{agents,sessions}`,
      //      so MUST run while ATTACH is live and BEFORE remap rewrites ids.
      //   2. transformAgentBlocksToParts — no ordering constraint with remap;
      //      operates on `content` JSON, ids unchanged.
      await backfillAgentOrderKeys(ctx.db)
      await transformAgentBlocksToParts(ctx.db)

      await ctx.db.run(sql.raw('COMMIT'))
      committed = true
      logger.info('Agents migration transaction committed successfully')

      // Prefix-id remap runs AFTER the outer COMMIT because it opens its own
      // BEGIN/COMMIT (nested SQLite transactions are not supported). It is
      // idempotent, so a retry after a partial failure is safe.
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

// ── Integrated post-copy shape transforms ────────────────────────────
//
// Exported as named helpers so they are unit-testable without constructing
// a full migrator / MigrationContext. `execute()` calls them inside the
// copy BEGIN/COMMIT block — failures roll back the entire import via
// SQLite ROLLBACK rather than leaving rows in an intermediate sentinel
// state. No silent post-hook semantics.

export interface BlocksToPartsTransformResult {
  totalMessages: number
  messagesConverted: number
  messagesSkipped: number
  errors: Array<{ rowId: string; error: string }>
}

/**
 * Convert `agent_session_message.content` from the legacy
 * `{ blocks: [...] }` shape into the current `{ data: { parts: [...] } }`
 * shape by reusing the same `transformBlocksToParts` converter regular
 * chat messages go through. Rows whose content has no legacy `blocks`
 * are skipped, so re-running is idempotent.
 */
export async function transformAgentBlocksToParts(db: DbType): Promise<BlocksToPartsTransformResult> {
  const result: BlocksToPartsTransformResult = {
    totalMessages: 0,
    messagesConverted: 0,
    messagesSkipped: 0,
    errors: []
  }

  const rows = await db.select().from(agentSessionMessageTable).orderBy(asc(agentSessionMessageTable.createdAt))
  result.totalMessages = rows.length
  logger.info(`Blocks→Parts: scanning ${rows.length} agent_session_message rows`)

  for (const row of rows) {
    if (!row?.content) {
      result.messagesSkipped++
      continue
    }

    try {
      // Legacy rows copied via raw INSERT...SELECT arrive as strings even
      // though Drizzle types the column as JSON — normalise both paths.
      const parsed = typeof row.content === 'string' ? JSON.parse(row.content) : row.content
      const blocks = parsed?.blocks ?? []
      const message = parsed?.message

      if (!message || blocks.length === 0) {
        result.messagesSkipped++
        continue
      }

      const { parts } = transformBlocksToParts(blocks)
      message.data = { ...message.data, parts }
      // Transient statuses (sending/pending/searching/processing) in persisted
      // rows are interrupted streams — collapse them to 'error' so the renderer
      // doesn't paint them as still-streaming. Parts are already in terminal
      // states after transformBlocksToParts.
      message.status = normalizeStatus(message.status)
      message.blocks = []
      parsed.blocks = []

      await db.update(agentSessionMessageTable).set({ content: parsed }).where(eq(agentSessionMessageTable.id, row.id))
      result.messagesConverted++
    } catch (error) {
      result.errors.push({ rowId: row.id, error: error instanceof Error ? error.message : String(error) })
      logger.warn(`Failed to transform agent_session_message ${row.id}`, { error })
    }
  }

  logger.info(
    `Blocks→Parts complete: ${result.messagesConverted} converted, ${result.messagesSkipped} skipped, ${result.errors.length} errors`
  )
  return result
}

/**
 * Replace `''` placeholder orderKeys (set by INSERT...SELECT) with real
 * fractional-indexing keys, ordered by the source `sort_order`. Joins target
 * rows to `agents_legacy.{agents,sessions}` so this MUST run while the source
 * DB is attached AND before remapAgentPrefixIds rewrites target ids.
 *
 * Sessions are scoped per agentId.
 */
export async function backfillAgentOrderKeys(db: DbType): Promise<void> {
  type Row = { id: string }

  const agents = (await db.all(
    sql.raw(
      `SELECT a.id AS id FROM agent a
       LEFT JOIN agents_legacy.agents s ON a.id = s.id
       WHERE a.order_key = ''
       ORDER BY COALESCE(s.sort_order, 0) ASC, a.id ASC`
    )
  )) as Row[]
  if (agents.length > 0) {
    const keys = generateOrderKeySequence(agents.length)
    for (let i = 0; i < agents.length; i++) {
      await db.run(sql`UPDATE agent SET order_key = ${keys[i]} WHERE id = ${agents[i].id}`)
    }
    logger.info(`Backfilled ${agents.length} agent order keys`)
  }

  const sessions = (await db.all(
    sql.raw(
      `SELECT a.id AS id, a.agent_id AS agent_id FROM agent_session a
       LEFT JOIN agents_legacy.sessions s ON a.id = s.id
       WHERE a.order_key = ''
       ORDER BY a.agent_id ASC, COALESCE(s.sort_order, 0) ASC, a.id ASC`
    )
  )) as Array<Row & { agent_id: string }>
  if (sessions.length === 0) return

  // Group by agentId and assign keys per group.
  const buckets = new Map<string, Row[]>()
  for (const row of sessions) {
    const list = buckets.get(row.agent_id) ?? []
    list.push({ id: row.id })
    buckets.set(row.agent_id, list)
  }
  for (const [, group] of buckets) {
    const keys = generateOrderKeySequence(group.length)
    for (let i = 0; i < group.length; i++) {
      await db.run(sql`UPDATE agent_session SET order_key = ${keys[i]} WHERE id = ${group[i].id}`)
    }
  }
  logger.info(`Backfilled ${sessions.length} session order keys across ${buckets.size} agents`)
}
