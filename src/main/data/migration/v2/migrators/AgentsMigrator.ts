import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTaskTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import {
  AGENT_SESSION_MESSAGE_INSERT_TRIGGER_NAME,
  AGENT_SESSION_MESSAGE_INSERT_TRIGGER_SQL,
  agentSessionMessageTable
} from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { jobScheduleTable } from '@data/db/schemas/job'
import type { DbType } from '@data/db/types'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { loggerService } from '@logger'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import type {
  MessageData,
  MessageRole,
  MessageSnapshot,
  MessageStats,
  MessageStatus,
  ModelSnapshot
} from '@shared/data/types/message'
import { eq, inArray, sql } from 'drizzle-orm'
import path from 'path'
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid'
import * as z from 'zod'

import type { MigrationContext } from '../core/MigrationContext'
import { LegacyAgentsDbReader } from '../utils/LegacyAgentsDbReader'
import { assignOrderKeysByScope, assignOrderKeysInSequence } from '../utils/orderKey'
import {
  type AgentFileSessionPlan,
  copyLegacyClaudeConfig,
  copyLegacyClaudeSessionData,
  isManagedLegacyAgentWorkspace,
  legacyAgentWorkspacePath,
  stageLegacyAgentFiles
} from './agentsFilesystemMigration'
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
import {
  type ChatMappingDeps,
  estimateLegacyRequestCount,
  mergeStats,
  normalizeStatus,
  transformBlocksToParts
} from './mappings/ChatMappings'
import { AGENT_TABLES, type AgentPrefixIdRemap, remapAgentPrefixIds } from './remapAgentPrefixIds'
import { type LegacyModelRef, legacyModelToUniqueId } from './transformers/ModelTransformers'

const DERIVED_SESSION_WORKSPACES_KEY = 'agentsMigrator.derivedSessionWorkspaces'
const LEGACY_SESSION_MESSAGE_BATCH_SIZE = 100
const LEGACY_SESSION_MESSAGE_SOURCE_CURSOR_TABLE = 'agent_session_message_source_cursor'
const LEGACY_SESSION_MESSAGE_STAGING_TABLE = 'agent_session_message_migration_staging'

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
  channel_agent_id: string | null
  task_agent_id: string
}

const HEARTBEAT_INTERVAL_FALLBACK_MS = 60 * 60_000
const AGENT_MESSAGE_IMPORT_SAVEPOINT = 'agent_message_batch_import'

const logger = loggerService.withContext('AgentsMigrator')

function formatMigrationByteCount(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1024; index++) {
    value /= 1024
    unit = units[index]
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`
}

export class AgentsMigrator extends BaseMigrator {
  readonly id = 'agents'
  readonly name = 'Agents'
  readonly description = 'Migrate legacy Agent data and Claude config into v2 storage'
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

    this.sourceSchemaInfo = reader.inspectSchema()
    this.sourceCounts = reader.countRows(this.sourceSchemaInfo)

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
    const executeStartedAt = performance.now()
    const claudeConfigStartedAt = performance.now()
    let reportedClaudeConfigProgress = 1
    this.reportProgress(reportedClaudeConfigProgress, 'Scanning Agent Claude configuration', {
      key: 'migration.progress.agents_claude_config_scanning_start'
    })
    const copiedLegacyClaudeConfig = await copyLegacyClaudeConfig(
      ctx.paths.legacyClaudeConfigDir,
      ctx.paths.claudeConfigDir,
      (progress) => {
        const phaseRange = {
          scanning: { start: 1, span: 14 },
          copying: { start: 15, span: 15 },
          verifying: { start: 30, span: 14 }
        }[progress.phase]
        const ratio =
          progress.byteTotal > 0
            ? progress.byteCount / progress.byteTotal
            : progress.total > 0
              ? progress.processed / progress.total
              : 0
        reportedClaudeConfigProgress = Math.max(
          reportedClaudeConfigProgress,
          phaseRange.start + Math.round(Math.min(Math.max(ratio, 0), 1) * phaseRange.span)
        )
        this.reportProgress(
          reportedClaudeConfigProgress,
          `Migrating Agent Claude configuration: ${progress.processed}/${progress.total} files`,
          {
            key: `migration.progress.agents_claude_config_${progress.phase}`,
            params: {
              processed: progress.processed,
              total: progress.total,
              byteCount: formatMigrationByteCount(progress.byteCount),
              byteTotal: formatMigrationByteCount(progress.byteTotal)
            }
          }
        )
      }
    )
    logger.info('Agent migration phase completed', {
      phase: 'claude-config',
      copied: copiedLegacyClaudeConfig,
      durationMs: Math.round(performance.now() - claudeConfigStartedAt)
    })
    this.reportProgress(45, 'Prepared Agent Claude configuration', {
      key: 'migration.progress.agents_claude_config'
    })

    const reader = this.createReader(ctx)
    const dbPath = this.resolveSourceDbPath(reader)

    if (!dbPath) {
      logger.info('No legacy agents.db found, skipping agents migration')
      this.reportProgress(98, 'No Agent database to migrate', {
        key: 'migration.progress.agents_database'
      })
      return { success: true, processedCount: 0 }
    }

    if (getTotalAgentsRowCount(this.sourceCounts) === 0) {
      this.sourceSchemaInfo = reader.inspectSchema()
      this.sourceCounts = reader.countRows(this.sourceSchemaInfo)
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

    // ATTACH/DETACH cannot run inside a transaction, so this work cannot use
    // db.transaction() (which wraps the callback in BEGIN/COMMIT). Use manual
    // BEGIN/COMMIT/ROLLBACK via db.run() so ATTACH, all INSERTs, and DETACH run
    // in order on the single connection, with the inserts kept atomic.
    const importStatements = statements.slice(1, -1)
    let isAttached = false
    let committed = false
    let pendingError: unknown = null

    try {
      ctx.db.run(sql.raw(statements[0])) // ATTACH DATABASE …
      isAttached = true
      const messagePreparationStartedAt = performance.now()
      const derivedSessionWorkspaces = await deriveSessionWorkspaces(ctx, this.sourceSchemaInfo)
      const stagedSessionMessageCount = await stageLegacySessionMessages(
        ctx.db,
        this.sourceSchemaInfo,
        {
          db: ctx.db,
          filesDataDir: ctx.paths.filesDataDir
        },
        (processed, total) => {
          const progress = total === 0 ? 55 : 45 + Math.round((processed / total) * 10)
          this.reportProgress(progress, `Prepared ${processed}/${total} Agent messages`, {
            key: 'migration.progress.agents_messages',
            params: { processed, total }
          })
        }
      )
      ctx.sharedData.set(DERIVED_SESSION_WORKSPACES_KEY, derivedSessionWorkspaces)
      logger.info('Agent migration phase completed', {
        phase: 'message-preparation',
        messages: stagedSessionMessageCount,
        workspaces: derivedSessionWorkspaces.workspaces.length,
        sessions: derivedSessionWorkspaces.mappings.length,
        durationMs: Math.round(performance.now() - messagePreparationStartedAt)
      })
      this.reportProgress(55, `Prepared ${stagedSessionMessageCount} Agent messages`, {
        key: 'migration.progress.agents_messages',
        params: { processed: stagedSessionMessageCount, total: stagedSessionMessageCount }
      })

      // Foreign keys are already OFF for the whole migration (MigrationDbService sets the
      // PRAGMA once on its single connection), so no per-call toggle here.
      const databaseImportStartedAt = performance.now()
      ctx.db.run(sql.raw('BEGIN'))

      insertSessionWorkspaces(ctx.db, derivedSessionWorkspaces)

      for (const statement of importStatements) {
        logger.debug('Executing SQL:', { sql: statement.substring(0, 200) })
        ctx.db.run(sql.raw(statement))
      }

      // Atomic post-INSERT reconciliation — runs INSIDE the BEGIN/COMMIT
      // so a failure rolls everything back instead of leaving rows in an
      // intermediate sentinel state (`order_key=''`).
      //
      // Order:
      //   1. backfillAgentOrderKeys — joins `agents_legacy.{agents,sessions}`,
      //      so MUST run while ATTACH is live and BEFORE remap rewrites ids.
      //   2. importLegacySessionMessages — generates UUID message ids instead
      //      of preserving legacy integer row ids, and writes final `data.parts`.
      backfillAgentOrderKeys(ctx.db)
      insertStagedLegacySessionMessages(ctx.db, stagedSessionMessageCount)
      migrateAgentMcps(ctx.db, ctx.sharedData.get('mcpServerIdMapping') as Map<string, string> | undefined)

      ctx.db.run(sql.raw('COMMIT'))
      committed = true
      logger.info('Agent migration phase completed', {
        phase: 'database-import',
        statements: importStatements.length,
        messages: stagedSessionMessageCount,
        durationMs: Math.round(performance.now() - databaseImportStartedAt)
      })
      this.reportProgress(55, 'Imported Agent database records', {
        key: 'migration.progress.agents_database'
      })

      // v1 scheduled_tasks → v2 job_schedule + agent_channel_task. Runs while
      // agents_legacy is still attached so the reads can target it directly via
      // ctx.db. Must happen BEFORE remapAgentPrefixIds — schedules carry the
      // legacy agent_id inside their jobInputTemplate JSON, and the remap step
      // rewrites both `agent.id` AND `job_schedule.jobInputTemplate.agentId`.
      await this.migrateScheduledTasksTs(ctx.db)

      // Prefix-id remap runs AFTER the outer COMMIT because it opens its own
      // BEGIN/COMMIT (nested SQLite transactions are not supported). It is
      // idempotent, so a retry after a partial failure is safe.
      const legacyAgentIds = ctx.db
        .all<{ id: string }>(sql.raw('SELECT id FROM agent ORDER BY id'))
        .map((row) => row.id)
      const idMappingStartedAt = performance.now()
      const idRemap = remapAgentPrefixIds(ctx.db)
      logger.info('Agent migration phase completed', {
        phase: 'id-mapping',
        agents: idRemap.agentIds.size,
        sessions: idRemap.sessionIds.size,
        durationMs: Math.round(performance.now() - idMappingStartedAt)
      })
      this.reportProgress(65, 'Remapped Agent and Session identifiers', {
        key: 'migration.progress.agents_id_mapping'
      })
      const finalSessionWorkspaces = finalizeSessionWorkspaces(ctx, derivedSessionWorkspaces, idRemap)
      ctx.sharedData.set(DERIVED_SESSION_WORKSPACES_KEY, finalSessionWorkspaces)
      const fileSessionPlans = toAgentFileSessionPlans(ctx.db, finalSessionWorkspaces, stagedSessionMessageCount)
      dropLegacySessionMessageStaging(ctx.db)
      const workspaceCopyStartedAt = performance.now()
      let reportedFileProgress = 65
      await stageLegacyAgentFiles({
        agentsDataRoot: ctx.paths.agentsDataDir,
        agents: legacyAgentIds.map((sourceAgentId) => ({
          sourceAgentId,
          finalAgentId: idRemap.agentIds.get(sourceAgentId) ?? sourceAgentId
        })),
        sessions: fileSessionPlans,
        onProgress: ({ phase, processed, total }) => {
          const phaseStart = phase === 'identity' ? 65 : 70
          const phaseSpan = phase === 'identity' ? 5 : 18
          const progress =
            total === 0 ? phaseStart + phaseSpan : phaseStart + Math.round((processed / total) * phaseSpan)
          reportedFileProgress = Math.max(reportedFileProgress, progress)
          this.reportProgress(reportedFileProgress, `Prepared ${processed}/${total} Agent ${phase} items`, {
            key: phase === 'identity' ? 'migration.progress.agents_identity' : 'migration.progress.agents_workspaces',
            params: { processed, total }
          })
        }
      })
      logger.info('Agent migration phase completed', {
        phase: 'workspace-copy',
        agents: legacyAgentIds.length,
        sessions: fileSessionPlans.length,
        durationMs: Math.round(performance.now() - workspaceCopyStartedAt)
      })
      this.reportProgress(88, 'Prepared Agent workspaces', {
        key: 'migration.progress.agents_workspaces',
        params: { processed: fileSessionPlans.length, total: fileSessionPlans.length }
      })
      const claudeCacheStartedAt = performance.now()
      await copyLegacyClaudeSessionData({
        agentsDataRoot: ctx.paths.agentsDataDir,
        sourceProjectsDirectories: copiedLegacyClaudeConfig
          ? [ctx.paths.legacyClaudeProjectsDir]
          : [ctx.paths.legacyClaudeProjectsDir, ctx.paths.claudeProjectsDir],
        destinationProjectsDirectory: ctx.paths.claudeProjectsDir,
        sessions: fileSessionPlans,
        onProgress: ({ processed, total }) => {
          const progress = total === 0 ? 97 : 88 + Math.round((processed / total) * 9)
          this.reportProgress(progress, `Prepared ${processed}/${total} Claude session transcripts`, {
            key: 'migration.progress.agents_claude_cache',
            params: { processed, total }
          })
        }
      })
      logger.info('Agent migration phase completed', {
        phase: 'claude-session-cache',
        sessions: fileSessionPlans.length,
        durationMs: Math.round(performance.now() - claudeCacheStartedAt)
      })
      this.reportProgress(97, 'Prepared Agent Claude session cache', {
        key: 'migration.progress.agents_claude_cache',
        params: { processed: fileSessionPlans.length, total: fileSessionPlans.length }
      })
      // Self-check agent-domain referential integrity after import + remap. FK is OFF for
      // the whole migration, so violations only surface here (and at the engine's final
      // verifyForeignKeys). foreign_key_check is read-only and stays on this connection, so
      // it is safe inside the ATTACH window.
      this.assertOwnedForeignKeys(ctx.db, AGENT_TABLES)
      this.reportProgress(98, 'Verified migrated Agent references', {
        key: 'migration.progress.agents_validation'
      })
    } catch (error) {
      if (!committed) {
        try {
          ctx.db.run(sql.raw('ROLLBACK'))
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

    try {
      dropLegacySessionMessageStaging(ctx.db)
    } catch (cleanupError) {
      logger.error('Failed to drop legacy Agent session message staging tables', cleanupError as Error)
      pendingError ??= cleanupError
    }

    if (isAttached) {
      try {
        ctx.db.run(sql.raw('DETACH DATABASE agents_legacy'))
      } catch (detachError) {
        // DETACH must not mask the original error; log loudly so it surfaces in diagnostics.
        logger.error('Failed to DETACH agents_legacy database', detachError as Error)
      }
    }

    if (pendingError) throw pendingError

    logger.info('Agent migration execute completed', {
      durationMs: Math.round(performance.now() - executeStartedAt)
    })
    return {
      success: true,
      processedCount: getTotalAgentsRowCount(this.sourceCounts)
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    const validationStartedAt = performance.now()
    this.reportProgress(99, 'Validating migrated Agent data', {
      key: 'migration.progress.agents_validation'
    })
    const reader = this.createReader(ctx)
    const dbPath = this.resolveSourceDbPath(reader)

    if (!dbPath) {
      logger.info('Agent migration phase completed', {
        phase: 'validation',
        sourceCount: 0,
        targetCount: 0,
        skippedCount: 0,
        errors: 0,
        durationMs: Math.round(performance.now() - validationStartedAt)
      })
      this.reportProgress(100, 'Validated migrated Agent data', {
        key: 'migration.progress.agents_validation'
      })
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
      this.sourceSchemaInfo = reader.inspectSchema()
      this.sourceCounts = reader.countRows(this.sourceSchemaInfo)
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

    ctx.db.run(sql.raw(`ATTACH DATABASE ${quoteSqlitePath(dbPath)} AS agents_legacy`))

    try {
      // v1 has no workspace table. v2 agent_workspace rows are derived from
      // session/agent accessible paths, or a generated default path per session.
      const derivedWorkspaces =
        (ctx.sharedData.get(DERIVED_SESSION_WORKSPACES_KEY) as DerivedSessionWorkspaces | undefined) ??
        (await deriveSessionWorkspaces(ctx, this.sourceSchemaInfo))
      const workspaceRows = ctx.db.all<{ count: number }>(sql.raw('SELECT COUNT(*) AS count FROM agent_workspace'))
      const workspaceTargetCount = Number(workspaceRows[0]?.count ?? 0)
      const workspaceExpectedCount = derivedWorkspaces.workspaces.length
      targetCount += workspaceTargetCount
      validationDetails.push({
        table: 'agent_workspace',
        source: 0,
        expected: workspaceExpectedCount,
        target: workspaceTargetCount,
        filtered: false,
        ok: workspaceTargetCount === workspaceExpectedCount
      })
      if (workspaceTargetCount !== workspaceExpectedCount) {
        const direction = workspaceTargetCount < workspaceExpectedCount ? 'too low' : 'too high'
        errors.push({
          key: 'agent_workspace_count_mismatch',
          expected: workspaceExpectedCount,
          actual: workspaceTargetCount,
          message: `agent_workspace count ${direction}: expected ${workspaceExpectedCount}, got ${workspaceTargetCount}`
        })
      }

      const invalidSessionWorkspaceRows = ctx.db.all<{ count: number }>(
        sql.raw(
          `SELECT COUNT(*) AS count
           FROM agent_session
           LEFT JOIN agent_workspace ON agent_workspace.id = agent_session.workspace_id
           WHERE agent_session.workspace_id IS NULL OR agent_workspace.id IS NULL`
        )
      )
      const invalidSessionWorkspaceCount = Number(invalidSessionWorkspaceRows[0]?.count ?? 0)
      if (invalidSessionWorkspaceCount > 0) {
        errors.push({
          key: 'agent_session_workspace_missing',
          expected: 0,
          actual: invalidSessionWorkspaceCount,
          message: `agent_session has ${invalidSessionWorkspaceCount} rows without a valid workspace`
        })
      }

      const targetWorkspacePathCounts = ctx.db.all<{ path: string; count: number }>(
        sql.raw(
          `SELECT agent_workspace.path AS path, COUNT(agent_session.id) AS count
           FROM agent_session
           INNER JOIN agent_workspace ON agent_workspace.id = agent_session.workspace_id
           GROUP BY agent_workspace.path`
        )
      )
      const expectedWorkspacePathCounts = countExpectedSessionWorkspacePaths(derivedWorkspaces)
      const targetWorkspacePathCountMap = new Map(
        targetWorkspacePathCounts.map((row) => [row.path, Number(row.count ?? 0)])
      )
      for (const [workspacePath, expectedCount] of expectedWorkspacePathCounts) {
        const actualCount = targetWorkspacePathCountMap.get(workspacePath) ?? 0
        if (actualCount !== expectedCount) {
          errors.push({
            key: 'agent_session_workspace_path_mismatch',
            expected: expectedCount,
            actual: actualCount,
            message: `agent_session workspace path mismatch for ${workspacePath}: expected ${expectedCount}, got ${actualCount}`
          })
        }
      }

      for (const spec of AGENTS_TABLE_MIGRATION_SPECS) {
        // Mirror the execute-side guard in buildAgentsImportStatements: legacy DBs
        // from older app versions may lack tables added later (e.g. agent_skills).
        if (!this.sourceSchemaInfo[spec.sourceTable].exists) {
          continue
        }

        const targetRows = ctx.db.all<{ count: number }>(sql.raw(`SELECT COUNT(*) AS count FROM ${spec.targetTable}`))
        const tableTargetCount = Number(targetRows[0]?.count ?? 0)
        const tableSourceCount = this.sourceCounts[spec.sourceTable]
        const validateWhere = spec.validateWhereClause ?? spec.whereClause
        const expectedRows = ctx.db.all<{ count: number }>(
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
        ctx.db.run(sql.raw('DETACH DATABASE agents_legacy'))
      } catch (detachError) {
        logger.error('Failed to DETACH agents_legacy database during validation', detachError as Error)
      }
    }

    logger.info('AgentsMigrator validation:', {
      validationDetails,
      errorCount: errors.length,
      totalSkipped: skippedCount
    })
    logger.info('Agent migration phase completed', {
      phase: 'validation',
      sourceCount: getTotalAgentsRowCount(this.sourceCounts),
      targetCount,
      skippedCount,
      errors: errors.length,
      durationMs: Math.round(performance.now() - validationStartedAt)
    })
    this.reportProgress(100, 'Validated migrated Agent data', {
      key: 'migration.progress.agents_validation'
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

  /**
   * Migrate v1 `scheduled_tasks` + `channel_task_subscriptions` into v2
   * `job_schedule` + `agent_channel_task`. v1 `task_run_logs` are intentionally
   * discarded — see breaking-changes/2026-05-19-agent-task-migration.md.
   */
  private async migrateScheduledTasksTs(db: MigrationContext['db']): Promise<void> {
    // Idempotency on retry: drop any partial agent.task schedules from a
    // previous failed run so the (type, name) UNIQUE index doesn't reject the
    // second-pass inserts. Other type rows are untouched.
    await db.delete(jobScheduleTable).where(sql`${jobScheduleTable.type} = 'agent.task'`)

    const v1Tasks = db.all<V1ScheduledTaskRow>(
      sql.raw(
        'SELECT id, agent_id, name, prompt, schedule_type, schedule_value, timeout_minutes, status ' +
          'FROM agents_legacy.scheduled_tasks ' +
          'WHERE agent_id IN (SELECT id FROM agent)'
      )
    )

    const idMap = new Map<string, string>()
    // (type='agent.task', name) is UNIQUE in job_schedule. Two v1 tasks with the
    // same name would collide and abort the whole migration, so track used names
    // and disambiguate within this run.
    const usedNames = new Set<string>()
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
      // JobScheduleNameAtomSchema rejects on the application boundary. Sanitize
      // so v2 reads are well-formed end-to-end.
      const rawName = v1.name?.trim() ?? ''
      let sanitizedName =
        rawName && !rawName.startsWith('__') && !this.hasControlChars(rawName)
          ? rawName.slice(0, 200)
          : `task_${v1.id}`.slice(0, 200)
      if (sanitizedName !== rawName) droppedNameCount++

      // Disambiguate on collision: fall back to the already-unique `task_<id>`
      // form (v1.id is unique), then append a numeric suffix if even that clashes.
      if (usedNames.has(sanitizedName)) {
        let candidate = `task_${v1.id}`.slice(0, 200)
        let suffix = 1
        while (usedNames.has(candidate)) {
          candidate = `task_${v1.id}_${suffix}`.slice(0, 200)
          suffix++
        }
        droppedNameCount++
        sanitizedName = candidate
      }
      usedNames.add(sanitizedName)

      const inserted = await db
        .insert(jobScheduleTable)
        .values({
          type: 'agent.task',
          name: sanitizedName,
          trigger,
          jobInputTemplate: {
            agentId: v1.agent_id,
            prompt: v1.prompt,
            timeoutMinutes: v1.timeout_minutes ?? 2,
            workspace: { type: 'system' }
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

    const v1Subs = db.all<V1ChannelTaskSubscription>(
      sql.raw(
        'SELECT s.channel_id, s.task_id, c.agent_id AS channel_agent_id, t.agent_id AS task_agent_id ' +
          'FROM agents_legacy.channel_task_subscriptions s ' +
          'JOIN agent_channel c ON c.id = s.channel_id ' +
          'JOIN agents_legacy.scheduled_tasks t ON t.id = s.task_id ' +
          'JOIN agent a ON a.id = t.agent_id'
      )
    )

    let subCount = 0
    let skippedCrossAgentSubCount = 0
    for (const sub of v1Subs) {
      const newScheduleId = idMap.get(sub.task_id)
      if (!newScheduleId) continue
      if (sub.channel_agent_id !== sub.task_agent_id) {
        skippedCrossAgentSubCount++
        continue
      }
      await db
        .insert(agentChannelTaskTable)
        .values({ channelId: sub.channel_id, taskId: newScheduleId })
        .onConflictDoNothing()
      subCount++
    }

    logger.info('Scheduled tasks migrated', {
      schedules: migratedCount,
      channelLinks: subCount,
      skippedCrossAgentChannelLinks: skippedCrossAgentSubCount,
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
}

type SessionWorkspaceSourceRow = {
  session_id: string
  agent_id: string
  session_accessible_paths: string | null
  agent_accessible_paths: string | null
  sort_order: number | null
  created_at: string | number | null
  updated_at: string | number | null
}

type DerivedWorkspace = {
  id: string
  name: string
  path: string
  type: 'user' | 'system'
  orderKey: string
  createdAt: number
  updatedAt: number
}

type DerivedSessionWorkspaceMap = {
  sessionId: string
  agentId: string
  finalSessionId?: string
  finalAgentId?: string
  workspaceId: string
  sourceWorkspacePath: string
  isManagedDefault: boolean
  createdAt: number
  updatedAt: number
}

type DerivedSessionWorkspaces = {
  workspaces: DerivedWorkspace[]
  mappings: DerivedSessionWorkspaceMap[]
}

type LegacySessionMessageRow = {
  sourceSequence: number
  legacyId: string | number | null
  sessionId: string
  role: string | null
  content: string | null
  agentSessionId: string | null
  createdAt: string | number | null
  updatedAt: string | number | null
}

type NormalizedLegacySessionMessage = {
  role: MessageRole
  data: MessageData
  searchableText: string
  status: MessageStatus
  modelId: string | null
  modelSnapshot: ModelSnapshot | null
  stats: MessageStats | null
}

type PreparedLegacySessionMessage = {
  sourceSequence: number
  id: string
  sessionId: string
  role: MessageRole
  data: MessageData
  searchableText: string
  status: MessageStatus
  modelId: string | null
  modelSnapshot: ModelSnapshot | null
  stats: MessageStats | null
  runtimeResumeToken: string | null
  createdAt: number
  updatedAt: number
}

function selectLegacySessionColumn(
  schemaInfo: AgentsSchemaInfo,
  column: string,
  alias: string,
  fallbackExpr: string
): string {
  return schemaInfo.sessions.columns.has(column) ? `sessions.${column} AS ${alias}` : `${fallbackExpr} AS ${alias}`
}

function selectLegacyAgentColumn(
  schemaInfo: AgentsSchemaInfo,
  column: string,
  alias: string,
  fallbackExpr: string
): string {
  return schemaInfo.agents.columns.has(column) ? `agents.${column} AS ${alias}` : `${fallbackExpr} AS ${alias}`
}

function selectSessionWorkspaceSourceRows(db: DbType, schemaInfo: AgentsSchemaInfo): SessionWorkspaceSourceRow[] {
  if (
    !schemaInfo.agents.exists ||
    !schemaInfo.sessions.exists ||
    !schemaInfo.agents.columns.has('id') ||
    !schemaInfo.sessions.columns.has('id') ||
    !schemaInfo.sessions.columns.has('agent_id')
  ) {
    return []
  }

  const sortOrder = schemaInfo.sessions.columns.has('sort_order') ? 'COALESCE(sessions.sort_order, 0)' : '0'
  const createdAt = schemaInfo.sessions.columns.has('created_at') ? 'sessions.created_at' : 'sessions.id'
  const columns = [
    'sessions.id AS session_id',
    'sessions.agent_id AS agent_id',
    selectLegacySessionColumn(schemaInfo, 'accessible_paths', 'session_accessible_paths', 'NULL'),
    selectLegacyAgentColumn(schemaInfo, 'accessible_paths', 'agent_accessible_paths', 'NULL'),
    selectLegacySessionColumn(schemaInfo, 'sort_order', 'sort_order', 'NULL'),
    selectLegacySessionColumn(schemaInfo, 'created_at', 'created_at', 'NULL'),
    selectLegacySessionColumn(schemaInfo, 'updated_at', 'updated_at', 'NULL')
  ]

  return db.all(
    sql.raw(
      `SELECT ${columns.join(', ')}
       FROM agents_legacy.sessions AS sessions
       INNER JOIN agents_legacy.agents AS agents ON agents.id = sessions.agent_id
       ORDER BY ${sortOrder} ASC, ${createdAt} ASC, sessions.id ASC`
    )
  ) as SessionWorkspaceSourceRow[]
}

function extractPrimaryWorkspacePath(rawPaths: string | null, source: 'session' | 'agent'): string | null {
  if (!rawPaths?.trim()) {
    return null
  }

  let parsed: unknown = rawPaths
  try {
    parsed = JSON.parse(rawPaths)
  } catch {
    // Some early local builds wrote a plain path string; accept it.
  }

  const candidate = Array.isArray(parsed) ? parsed[0] : typeof parsed === 'string' ? parsed : null

  if (typeof candidate !== 'string') {
    return null
  }

  const trimmed = candidate?.trim()
  if (!trimmed) {
    return null
  }
  if (!path.isAbsolute(trimmed)) {
    logger.warn('Skipping legacy primary workspace because path is not absolute', { source, path: trimmed })
    return null
  }
  return path.normalize(trimmed)
}

function workspaceNameFromPath(workspacePath: string): string {
  return path.basename(workspacePath) || workspacePath
}

function legacyTimestampToMs(value: string | number | null, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 && value < 10_000_000_000 ? value * 1000 : value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return fallback
    const numericValue = Number(trimmed)
    if (Number.isFinite(numericValue)) {
      return numericValue > 0 && numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue
    }
    const parsed = Date.parse(trimmed)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

function countExpectedSessionWorkspacePaths(derived: DerivedSessionWorkspaces): Map<string, number> {
  const workspacePathById = new Map(derived.workspaces.map((workspace) => [workspace.id, workspace.path]))
  const counts = new Map<string, number>()
  for (const mapping of derived.mappings) {
    const workspacePath = workspacePathById.get(mapping.workspaceId)
    if (!workspacePath) continue
    counts.set(workspacePath, (counts.get(workspacePath) ?? 0) + 1)
  }
  return counts
}

async function deriveSessionWorkspaces(
  ctx: MigrationContext,
  schemaInfo: AgentsSchemaInfo
): Promise<DerivedSessionWorkspaces> {
  const rows = selectSessionWorkspaceSourceRows(ctx.db, schemaInfo)
  const byPath = new Map<string, DerivedWorkspace>()
  const mappings: DerivedSessionWorkspaceMap[] = []
  const migrationStartedAtMs = Date.now()
  const agentsDataDir = ctx.paths.agentsDataDir
  const systemWorkspacesDir = ctx.paths.agentSystemWorkspacesDir

  for (const row of rows) {
    const explicitWorkspacePath =
      extractPrimaryWorkspacePath(row.session_accessible_paths, 'session') ??
      extractPrimaryWorkspacePath(row.agent_accessible_paths, 'agent')
    const sourceWorkspacePath = explicitWorkspacePath ?? legacyAgentWorkspacePath(agentsDataDir, row.agent_id)
    const isManagedDefault = await isManagedLegacyAgentWorkspace(agentsDataDir, row.agent_id, sourceWorkspacePath)
    const createdAt = legacyTimestampToMs(row.created_at, migrationStartedAtMs)
    const updatedAt = legacyTimestampToMs(row.updated_at, createdAt)
    const workspacePath = isManagedDefault
      ? agentWorkspaceService.buildSystemWorkspacePath(systemWorkspacesDir, row.session_id, createdAt)
      : sourceWorkspacePath
    const workspaceType = isManagedDefault ? 'system' : 'user'

    let workspace = byPath.get(workspacePath)
    if (!workspace) {
      workspace = {
        id: uuidv4(),
        name: workspaceNameFromPath(workspacePath),
        path: workspacePath,
        type: workspaceType,
        orderKey: '',
        createdAt,
        updatedAt
      }
      byPath.set(workspacePath, workspace)
    }

    mappings.push({
      sessionId: row.session_id,
      agentId: row.agent_id,
      workspaceId: workspace.id,
      sourceWorkspacePath,
      isManagedDefault,
      createdAt,
      updatedAt
    })
  }

  const workspaces = assignOrderKeysInSequence(Array.from(byPath.values()))

  return { workspaces, mappings }
}

function insertSessionWorkspaces(db: DbType, derived: DerivedSessionWorkspaces): void {
  db.run(
    sql.raw('CREATE TEMP TABLE IF NOT EXISTS session_workspace_map (session_id TEXT PRIMARY KEY, workspace_id TEXT)')
  )
  db.run(sql.raw('DELETE FROM session_workspace_map'))

  for (const workspace of derived.workspaces) {
    db.run(
      sql`INSERT INTO agent_workspace (id, name, path, type, order_key, created_at, updated_at)
          VALUES (${workspace.id}, ${workspace.name}, ${workspace.path}, ${workspace.type}, ${workspace.orderKey}, ${workspace.createdAt}, ${workspace.updatedAt})`
    )
  }
  for (const mapping of derived.mappings) {
    db.run(
      sql`INSERT INTO session_workspace_map (session_id, workspace_id) VALUES (${mapping.sessionId}, ${mapping.workspaceId})`
    )
  }

  logger.info('Staged derived session workspaces', {
    workspaces: derived.workspaces.length,
    mappedSessions: derived.mappings.length
  })
}

function finalizeSessionWorkspaces(
  ctx: MigrationContext,
  derived: DerivedSessionWorkspaces,
  idRemap: AgentPrefixIdRemap
): DerivedSessionWorkspaces {
  const workspacesById = new Map(derived.workspaces.map((workspace) => [workspace.id, { ...workspace }]))
  const mappings = derived.mappings.map((mapping) => {
    const finalSessionId = idRemap.sessionIds.get(mapping.sessionId) ?? mapping.sessionId
    const finalAgentId = idRemap.agentIds.get(mapping.agentId) ?? mapping.agentId
    const workspace = workspacesById.get(mapping.workspaceId)
    if (workspace?.type === 'system') {
      const workspacePath = agentWorkspaceService.buildSystemWorkspacePath(
        ctx.paths.agentSystemWorkspacesDir,
        finalSessionId,
        mapping.createdAt
      )
      workspace.path = workspacePath
      workspace.name = workspaceNameFromPath(workspacePath)
      ctx.db.run(
        sql`UPDATE ${agentWorkspaceTable}
            SET path = ${workspace.path}, name = ${workspace.name}
            WHERE ${agentWorkspaceTable.id} = ${workspace.id}`
      )
    }
    return {
      ...mapping,
      finalSessionId,
      finalAgentId
    }
  })

  return { workspaces: Array.from(workspacesById.values()), mappings }
}

function toAgentFileSessionPlans(
  db: DbType,
  derived: DerivedSessionWorkspaces,
  stagedSessionMessageCount: number
): AgentFileSessionPlan[] {
  const workspacesById = new Map(derived.workspaces.map((workspace) => [workspace.id, workspace]))
  const runtimeResumeTokensBySessionId = new Map<string, Set<string>>()
  const latestRuntimeResumeTokenBySessionId = new Map<string, string>()

  if (stagedSessionMessageCount > 0) {
    let afterSequence = 0
    while (true) {
      const rows = db.all<{ sourceSequence: number; sessionId: string; runtimeResumeToken: string }>(
        sql.raw(
          `SELECT source_sequence AS sourceSequence,
                  session_id AS sessionId,
                  runtime_resume_token AS runtimeResumeToken
           FROM ${LEGACY_SESSION_MESSAGE_STAGING_TABLE}
           WHERE source_sequence > ${afterSequence}
             AND runtime_resume_token IS NOT NULL
             AND runtime_resume_token <> ''
           ORDER BY source_sequence
           LIMIT ${LEGACY_SESSION_MESSAGE_BATCH_SIZE}`
        )
      )
      if (rows.length === 0) break

      for (const row of rows) {
        const runtimeResumeTokens = runtimeResumeTokensBySessionId.get(row.sessionId) ?? new Set<string>()
        runtimeResumeTokens.add(row.runtimeResumeToken)
        runtimeResumeTokensBySessionId.set(row.sessionId, runtimeResumeTokens)
        latestRuntimeResumeTokenBySessionId.set(row.sessionId, row.runtimeResumeToken)
      }
      afterSequence = rows.at(-1)!.sourceSequence
    }
  }

  return derived.mappings.map((mapping) => {
    const workspace = workspacesById.get(mapping.workspaceId)
    if (!workspace) throw new Error(`Missing derived workspace for session ${mapping.sessionId}`)
    return {
      sourceSessionId: mapping.sessionId,
      finalSessionId: mapping.finalSessionId ?? mapping.sessionId,
      sourceAgentId: mapping.agentId,
      finalAgentId: mapping.finalAgentId ?? mapping.agentId,
      sourceWorkspacePath: mapping.sourceWorkspacePath,
      isManagedDefault: mapping.isManagedDefault,
      systemWorkspacePath: workspace.type === 'system' ? workspace.path : undefined,
      latestRuntimeResumeToken: latestRuntimeResumeTokenBySessionId.get(mapping.sessionId),
      runtimeResumeTokens: Array.from(runtimeResumeTokensBySessionId.get(mapping.sessionId) ?? []).sort(),
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt
    }
  })
}

function selectLegacyMessageColumn(
  schemaInfo: AgentsSchemaInfo,
  column: string,
  alias: string,
  fallbackExpr: string
): string {
  return schemaInfo.session_messages.columns.has(column)
    ? `messages.${column} AS ${alias}`
    : `${fallbackExpr} AS ${alias}`
}

function normalizeLegacyRole(value: string | null): MessageRole {
  return value === 'user' || value === 'assistant' || value === 'system' ? value : 'assistant'
}

function searchableTextFromParts(parts: unknown[] | undefined): string {
  const searchableText: string[] = []
  for (const part of parts ?? []) {
    if (!part || typeof part !== 'object') continue
    const candidate = part as { type?: unknown; text?: unknown }
    if ((candidate.type === 'text' || candidate.type === 'reasoning') && typeof candidate.text === 'string') {
      searchableText.push(candidate.text)
    }
  }
  return searchableText.join('\n')
}

// Legacy v1 model blobs are untrusted JSON. `.catch(undefined)` keeps a
// malformed optional field from failing the whole parse (we still want id +
// provider even if `name`/`group` are junk), matching the old lenient narrowing.
const LegacyModelRefSchema = z.object({
  id: z.string().optional().catch(undefined),
  provider: z.string().optional().catch(undefined)
})
const LegacyModelSnapshotSchema = LegacyModelRefSchema.extend({
  name: z.string().optional().catch(undefined),
  group: z.string().optional().catch(undefined)
})

function asLegacyModelRef(value: unknown): LegacyModelRef | null {
  const parsed = LegacyModelRefSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function buildModelSnapshot(value: unknown): ModelSnapshot | null {
  const parsed = LegacyModelSnapshotSchema.safeParse(value)
  if (!parsed.success) return null

  const { id, provider, name, group } = parsed.data
  if (!id?.trim() || !provider?.trim()) return null

  return {
    id,
    name: name?.trim() ? name : id,
    provider,
    group
  }
}

async function normalizeLegacySessionMessage(
  content: unknown,
  fallbackRole: string | null,
  deps?: ChatMappingDeps
): Promise<NormalizedLegacySessionMessage> {
  const parsed = typeof content === 'string' ? JSON.parse(content) : content
  const directParts = parsed && typeof parsed === 'object' && Array.isArray(parsed.parts) ? parsed.parts : null
  if (directParts) {
    return {
      role: normalizeLegacyRole(fallbackRole),
      data: { parts: directParts },
      searchableText: searchableTextFromParts(directParts),
      status: 'success',
      modelId: null,
      modelSnapshot: null,
      stats: null
    }
  }

  const message = parsed && typeof parsed === 'object' ? parsed.message : null
  const blocks = parsed && typeof parsed === 'object' && Array.isArray(parsed.blocks) ? parsed.blocks : []
  if (!message) {
    return {
      role: normalizeLegacyRole(fallbackRole),
      data: { parts: [] },
      searchableText: '',
      status: 'success',
      modelId: null,
      modelSnapshot: null,
      stats: null
    }
  }

  const transformed = blocks.length > 0 ? await transformBlocksToParts(blocks, deps) : null
  const parts = transformed?.parts ?? (Array.isArray(message.data?.parts) ? message.data.parts : [])
  const rawModelId = typeof message.modelId === 'string' && message.modelId.length > 0 ? message.modelId : null
  const modelRef = asLegacyModelRef(message.model)
  return {
    role: normalizeLegacyRole(typeof message.role === 'string' ? message.role : fallbackRole),
    data: { parts },
    searchableText: searchableTextFromParts(parts),
    status: normalizeStatus(message.status),
    modelId: legacyModelToUniqueId(modelRef, rawModelId) ?? rawModelId,
    modelSnapshot: buildModelSnapshot(message.model),
    stats: mergeStats(
      message.usage,
      message.metrics,
      normalizeLegacyRole(typeof message.role === 'string' ? message.role : fallbackRole) === 'assistant'
        ? estimateLegacyRequestCount(blocks)
        : undefined
    )
  }
}

/** The producing author of a session message — the owning agent, model excluded. */
type SessionAuthor = Omit<MessageSnapshot, 'model'>

/**
 * Author identity per migrated session, so each imported message can freeze the same
 * {@link MessageSnapshot} the runtime writer persists (author with the model nested).
 * Sessions whose agent is missing get no author, hence no snapshot.
 */
function readSessionAuthors(db: DbType, sessionIds: string[]): Map<string, SessionAuthor> {
  if (sessionIds.length === 0) return new Map()

  const rows = db
    .select({
      sessionId: agentSessionTable.id,
      agentId: agentTable.id,
      name: agentTable.name,
      configuration: agentTable.configuration
    })
    .from(agentSessionTable)
    .innerJoin(agentTable, eq(agentSessionTable.agentId, agentTable.id))
    .where(inArray(agentSessionTable.id, sessionIds))
    .all()

  return new Map(
    rows.map((row): [string, SessionAuthor] => {
      const avatar = row.configuration?.avatar
      return [
        row.sessionId,
        { id: row.agentId, name: row.name, emoji: typeof avatar === 'string' && avatar ? avatar : undefined }
      ]
    })
  )
}

function resolveUserModelId(db: DbType, cache: Map<string, string | null>, rawModelId: string | null): string | null {
  if (!rawModelId) return null
  if (cache.has(rawModelId)) return cache.get(rawModelId) ?? null

  const rows = db.all<{ id: string }>(
    sql`SELECT id FROM user_model WHERE id = ${rawModelId} OR (provider_id || ':' || model_id) = ${rawModelId} LIMIT 1`
  )
  const resolved = rows[0]?.id ?? null
  cache.set(rawModelId, resolved)
  return resolved
}

function createLegacySessionMessageStaging(db: DbType, schemaInfo: AgentsSchemaInfo): void {
  db.run(sql.raw('PRAGMA temp_store = FILE'))
  dropLegacySessionMessageStaging(db)
  // Materialize only ordered source rowids first. The generated sequence is a
  // stable keyset cursor across async file promotion without copying message
  // payloads into V8 or paying OFFSET's repeated scan cost.
  db.run(
    sql.raw(
      `CREATE TEMP TABLE ${LEGACY_SESSION_MESSAGE_SOURCE_CURSOR_TABLE} (
         sequence INTEGER PRIMARY KEY AUTOINCREMENT,
         source_rowid INTEGER NOT NULL UNIQUE
       )`
    )
  )
  db.run(
    sql.raw(
      `CREATE TEMP TABLE ${LEGACY_SESSION_MESSAGE_STAGING_TABLE} (
         source_sequence INTEGER PRIMARY KEY,
         id TEXT NOT NULL,
         session_id TEXT NOT NULL,
         role TEXT NOT NULL,
         data TEXT NOT NULL,
         searchable_text TEXT NOT NULL,
         status TEXT NOT NULL,
         model_id TEXT,
         model_snapshot TEXT,
         stats TEXT,
         runtime_resume_token TEXT,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       )`
    )
  )

  const orderBy = [
    schemaInfo.session_messages.columns.has('created_at') ? 'messages.created_at ASC' : null,
    schemaInfo.session_messages.columns.has('id') ? 'messages.id ASC' : null,
    'messages.rowid ASC'
  ]
    .filter(Boolean)
    .join(', ')
  db.run(
    sql.raw(
      `INSERT INTO ${LEGACY_SESSION_MESSAGE_SOURCE_CURSOR_TABLE} (source_rowid)
       SELECT messages.rowid
       FROM agents_legacy.session_messages AS messages
       WHERE messages.session_id IN (
         SELECT sessions.id
         FROM agents_legacy.sessions AS sessions
         WHERE sessions.agent_id IN (SELECT id FROM agents_legacy.agents)
       )
       ORDER BY ${orderBy}`
    )
  )
}

function dropLegacySessionMessageStaging(db: DbType): void {
  db.run(sql.raw(`DROP TABLE IF EXISTS ${LEGACY_SESSION_MESSAGE_STAGING_TABLE}`))
  db.run(sql.raw(`DROP TABLE IF EXISTS ${LEGACY_SESSION_MESSAGE_SOURCE_CURSOR_TABLE}`))
}

function insertLegacySessionMessageStagingBatch(db: DbType, prepared: PreparedLegacySessionMessage[]): void {
  if (prepared.length === 0) return

  db.run(sql.raw('SAVEPOINT stage_legacy_agent_session_messages'))
  try {
    for (const message of prepared) {
      db.run(sql`
        INSERT INTO ${sql.raw(LEGACY_SESSION_MESSAGE_STAGING_TABLE)}
          (
            source_sequence, id, session_id, role, data, searchable_text, status, model_id,
            model_snapshot, stats, runtime_resume_token, created_at, updated_at
          )
        VALUES
          (
            ${message.sourceSequence},
            ${message.id},
            ${message.sessionId},
            ${message.role},
            ${JSON.stringify(message.data)},
            ${message.searchableText},
            ${message.status},
            ${message.modelId},
            ${message.modelSnapshot ? JSON.stringify(message.modelSnapshot) : null},
            ${message.stats ? JSON.stringify(message.stats) : null},
            ${message.runtimeResumeToken},
            ${message.createdAt},
            ${message.updatedAt}
          )
      `)
    }
    db.run(sql.raw('RELEASE SAVEPOINT stage_legacy_agent_session_messages'))
  } catch (error) {
    db.run(sql.raw('ROLLBACK TO SAVEPOINT stage_legacy_agent_session_messages'))
    db.run(sql.raw('RELEASE SAVEPOINT stage_legacy_agent_session_messages'))
    throw error
  }
}

async function stageLegacySessionMessages(
  db: DbType,
  schemaInfo: AgentsSchemaInfo,
  deps?: ChatMappingDeps,
  onProgress?: (processed: number, total: number) => void
): Promise<number> {
  if (
    !schemaInfo.session_messages.exists ||
    !schemaInfo.session_messages.columns.has('session_id') ||
    !schemaInfo.sessions.exists ||
    !schemaInfo.sessions.columns.has('agent_id') ||
    !schemaInfo.agents.exists
  ) {
    return 0
  }

  createLegacySessionMessageStaging(db, schemaInfo)
  const selectColumns = [
    selectLegacyMessageColumn(schemaInfo, 'id', 'legacyId', 'NULL'),
    selectLegacyMessageColumn(schemaInfo, 'session_id', 'sessionId', 'NULL'),
    selectLegacyMessageColumn(schemaInfo, 'role', 'role', "'assistant'"),
    selectLegacyMessageColumn(schemaInfo, 'content', 'content', 'NULL'),
    selectLegacyMessageColumn(schemaInfo, 'agent_session_id', 'agentSessionId', 'NULL'),
    selectLegacyMessageColumn(schemaInfo, 'created_at', 'createdAt', 'NULL'),
    selectLegacyMessageColumn(schemaInfo, 'updated_at', 'updatedAt', 'NULL')
  ]
  const totalRows = Number(
    db.all<{ count: number }>(sql.raw(`SELECT COUNT(*) AS count FROM ${LEGACY_SESSION_MESSAGE_SOURCE_CURSOR_TABLE}`))[0]
      ?.count ?? 0
  )
  const modelCache = new Map<string, string | null>()
  let afterSequence = 0
  let stagedCount = 0

  while (true) {
    const rows = db.all<LegacySessionMessageRow>(
      sql.raw(
        `SELECT cursor.sequence AS sourceSequence, ${selectColumns.join(', ')}
         FROM ${LEGACY_SESSION_MESSAGE_SOURCE_CURSOR_TABLE} AS cursor
         INNER JOIN agents_legacy.session_messages AS messages
           ON messages.rowid = cursor.source_rowid
         WHERE cursor.sequence > ${afterSequence}
         ORDER BY cursor.sequence
         LIMIT ${LEGACY_SESSION_MESSAGE_BATCH_SIZE}`
      )
    )
    if (rows.length === 0) break

    const prepared: PreparedLegacySessionMessage[] = []
    for (const row of rows) {
      if (!row.sessionId) continue
      let normalized: NormalizedLegacySessionMessage
      try {
        normalized = await normalizeLegacySessionMessage(row.content, row.role, deps)
      } catch (error) {
        normalized = {
          role: normalizeLegacyRole(row.role),
          data: { parts: [] },
          searchableText: '',
          status: 'error',
          modelId: null,
          modelSnapshot: null,
          stats: null
        }
        logger.warn('Failed to normalize legacy agent session message', {
          legacyId: row.legacyId,
          sessionId: row.sessionId,
          error
        })
      }

      const now = Date.now()
      const createdAt = legacyTimestampToMs(row.createdAt, now)
      const updatedAt = row.updatedAt == null ? createdAt : legacyTimestampToMs(row.updatedAt, createdAt)
      prepared.push({
        sourceSequence: row.sourceSequence,
        id: uuidv7(),
        sessionId: row.sessionId,
        role: normalized.role,
        data: normalized.data,
        searchableText: normalized.searchableText,
        status: normalized.status,
        modelId: resolveUserModelId(db, modelCache, normalized.modelId),
        modelSnapshot: normalized.modelSnapshot,
        stats: normalized.stats,
        runtimeResumeToken: row.agentSessionId,
        createdAt,
        updatedAt
      })
    }

    insertLegacySessionMessageStagingBatch(db, prepared)
    stagedCount += prepared.length
    afterSequence = rows.at(-1)!.sourceSequence
    onProgress?.(Math.min(afterSequence, totalRows), totalRows)
  }

  logger.info('Staged legacy agent session messages in bounded batches', { staged: stagedCount })
  return stagedCount
}

type StagedLegacySessionMessageRow = {
  sourceSequence: number
  id: string
  sessionId: string
  role: MessageRole
  data: string
  searchableText: string
  status: MessageStatus
  modelId: string | null
  modelSnapshot: string | null
  stats: string | null
  runtimeResumeToken: string | null
  createdAt: number
  updatedAt: number
}

function insertStagedLegacySessionMessages(db: DbType, stagedCount: number): number {
  if (stagedCount === 0) return 0

  const maxFtsRowid = Number(
    db.all<{ maxFtsRowid: number | null }>(
      sql.raw('SELECT MAX(fts_rowid) AS maxFtsRowid FROM agent_session_message')
    )[0]?.maxFtsRowid ?? 0
  )

  db.run(sql.raw(`SAVEPOINT ${AGENT_MESSAGE_IMPORT_SAVEPOINT}`))
  try {
    db.run(sql.raw(`DROP TRIGGER IF EXISTS ${AGENT_SESSION_MESSAGE_INSERT_TRIGGER_NAME}`))
    let afterSequence = 0
    let imported = 0

    while (imported < stagedCount) {
      const rows = db.all<StagedLegacySessionMessageRow>(
        sql.raw(
          `SELECT source_sequence AS sourceSequence,
                  id,
                  session_id AS sessionId,
                  role,
                  data,
                  searchable_text AS searchableText,
                  status,
                  model_id AS modelId,
                  model_snapshot AS modelSnapshot,
                  stats,
                  runtime_resume_token AS runtimeResumeToken,
                  created_at AS createdAt,
                  updated_at AS updatedAt
           FROM ${LEGACY_SESSION_MESSAGE_STAGING_TABLE}
           WHERE source_sequence > ${afterSequence}
           ORDER BY source_sequence
           LIMIT ${LEGACY_SESSION_MESSAGE_BATCH_SIZE}`
        )
      )
      if (rows.length === 0) {
        throw new Error(`Staged Agent message import stopped after ${imported}/${stagedCount} rows`)
      }

      const sessionAuthors = readSessionAuthors(db, Array.from(new Set(rows.map((row) => row.sessionId))))
      const values = rows.map((row, index) => {
        // Resolve authors only after the target agent/session rows have been inserted.
        // Message normalization remains outside the transaction, while immutable
        // snapshots are assembled one bounded page at a time.
        const author = sessionAuthors.get(row.sessionId)
        const modelSnapshot = row.modelSnapshot ? (JSON.parse(row.modelSnapshot) as ModelSnapshot) : null
        const messageSnapshot = author && modelSnapshot ? { ...author, model: modelSnapshot } : undefined
        return {
          id: row.id,
          sessionId: row.sessionId,
          role: row.role,
          data: JSON.parse(row.data) as MessageData,
          searchableText: row.searchableText,
          status: row.status,
          modelId: row.modelId,
          messageSnapshot,
          stats: row.stats ? (JSON.parse(row.stats) as MessageStats) : undefined,
          runtimeResumeToken: row.runtimeResumeToken,
          ftsRowid: maxFtsRowid + imported + index + 1,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        }
      })

      db.insert(agentSessionMessageTable).values(values).run()
      imported += rows.length
      afterSequence = rows.at(-1)!.sourceSequence
    }

    db.run(sql.raw("INSERT INTO agent_session_message_fts(agent_session_message_fts) VALUES ('rebuild')"))
    db.run(sql.raw(AGENT_SESSION_MESSAGE_INSERT_TRIGGER_SQL))
    db.run(sql.raw(`RELEASE SAVEPOINT ${AGENT_MESSAGE_IMPORT_SAVEPOINT}`))
    logger.info('Imported staged legacy agent session messages with UUID ids', {
      imported,
      batchSize: LEGACY_SESSION_MESSAGE_BATCH_SIZE
    })
    return imported
  } catch (error) {
    try {
      db.run(sql.raw(`ROLLBACK TO SAVEPOINT ${AGENT_MESSAGE_IMPORT_SAVEPOINT}`))
      db.run(sql.raw(`RELEASE SAVEPOINT ${AGENT_MESSAGE_IMPORT_SAVEPOINT}`))
    } catch (rollbackError) {
      logger.error('Failed to roll back batched Agent message import', rollbackError as Error)
    }
    throw error
  }
}

export async function importLegacySessionMessages(
  db: DbType,
  schemaInfo: AgentsSchemaInfo,
  deps?: ChatMappingDeps
): Promise<number> {
  try {
    const stagedCount = await stageLegacySessionMessages(db, schemaInfo, deps)
    return insertStagedLegacySessionMessages(db, stagedCount)
  } finally {
    dropLegacySessionMessageStaging(db)
  }
}

/**
 * Migrate legacy `agent.mcps` JSON arrays into `agent_mcp_server` junction
 * table rows. Legacy rows reference old-format MCP ids that McpServerMigrator
 * regenerated as new UUIDs, so each id is remapped via the shared
 * `mcpServerIdMapping`; ids with no mapping (deleted/skipped servers) are
 * dropped to avoid FK constraint violations. Runs while agents_legacy is
 * attached and BEFORE remapAgentPrefixIds — the inserted `agentId` is the
 * legacy agent id, which that step rewrites alongside `agent.id`.
 */
export function migrateAgentMcps(db: DbType, mcpServerIdMapping: Map<string, string> | undefined): void {
  const rows = db.all<{ agentId: string; oldMcpId: string }>(
    sql.raw(
      `SELECT DISTINCT a.id AS agentId, je.value AS oldMcpId
       FROM agents_legacy.agents a, json_each(a.mcps) AS je
       WHERE json_type(a.mcps) = 'array'
         AND json_array_length(a.mcps) > 0
         AND a.id IN (SELECT id FROM agent)`
    )
  )
  if (rows.length === 0) return

  if (!mcpServerIdMapping) {
    throw new Error(
      `mcpServerIdMapping not found in sharedData but ${rows.length} agent_mcp_server rows need remapping. McpServerMigrator must run before AgentsMigrator.`
    )
  }

  const now = Date.now()
  const values = rows.reduce<{ agentId: string; mcpServerId: string; createdAt: number; updatedAt: number }[]>(
    (acc, row) => {
      const newMcpId = mcpServerIdMapping.get(row.oldMcpId)
      if (!newMcpId) {
        logger.warn(`Dropping dangling agent_mcp_server ref: agent=${row.agentId}, mcpServer=${row.oldMcpId}`)
        return acc
      }
      acc.push({ agentId: row.agentId, mcpServerId: newMcpId, createdAt: now, updatedAt: now })
      return acc
    },
    []
  )

  if (values.length === 0) return
  db.insert(agentMcpServerTable).values(values).onConflictDoNothing().run()
  const dropped = rows.length - values.length
  const summary = { rows: values.length, dropped }
  // A non-zero `dropped` count is FK-mandated data loss (legacy refs to MCP
  // servers that no longer exist) — surface it at warn so it stands out.
  if (dropped > 0) {
    logger.warn('Migrated agent MCP associations to junction table; dropped dangling refs', summary)
  } else {
    logger.info('Migrated agent MCP associations to junction table', summary)
  }
}

/**
 * Replace `''` placeholder orderKeys (set by INSERT...SELECT) with real
 * fractional-indexing keys, ordered by the source `sort_order`. Joins target
 * rows to `agents_legacy.{agents,sessions}` so this MUST run while the source
 * DB is attached AND before remapAgentPrefixIds rewrites target ids.
 *
 * Sessions are scoped per agentId.
 */
export function backfillAgentOrderKeys(db: DbType): void {
  type Row = { id: string }

  const agents = db.all(
    sql.raw(
      `SELECT a.id AS id FROM agent a
       LEFT JOIN agents_legacy.agents s ON a.id = s.id
       WHERE a.order_key = ''
       ORDER BY COALESCE(s.sort_order, 0) ASC, a.id ASC`
    )
  ) as Row[]
  if (agents.length > 0) {
    for (const agent of assignOrderKeysInSequence(agents)) {
      db.run(sql`UPDATE agent SET order_key = ${agent.orderKey} WHERE id = ${agent.id}`)
    }
    logger.info(`Backfilled ${agents.length} agent order keys`)
  }

  const sessions = db.all(
    sql.raw(
      `SELECT a.id AS id, a.agent_id AS agent_id FROM agent_session a
       LEFT JOIN agents_legacy.sessions s ON a.id = s.id
       WHERE a.order_key = ''
       ORDER BY a.agent_id ASC, COALESCE(s.sort_order, 0) ASC, a.id ASC`
    )
  ) as Array<Row & { agent_id: string }>
  if (sessions.length === 0) return

  const stampedSessions = assignOrderKeysByScope(sessions, (row) => row.agent_id)
  for (const session of stampedSessions) {
    db.run(sql`UPDATE agent_session SET order_key = ${session.orderKey} WHERE id = ${session.id}`)
  }
  const agentCount = new Set(sessions.map((row) => row.agent_id)).size
  logger.info(`Backfilled ${sessions.length} session order keys across ${agentCount} agents`)
}
