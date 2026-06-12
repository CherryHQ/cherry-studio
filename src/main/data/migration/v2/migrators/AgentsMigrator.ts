import { agentChannelTaskTable } from '@data/db/schemas/agentChannel'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { jobScheduleTable } from '@data/db/schemas/job'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import type { MessageData, MessageRole, MessageStatus } from '@shared/data/types/message'
import { sql } from 'drizzle-orm'
import path from 'path'
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid'

import type { MigrationContext } from '../core/MigrationContext'
import { LegacyAgentsDbReader } from '../utils/LegacyAgentsDbReader'
import { assignOrderKeysByScope, assignOrderKeysInSequence } from '../utils/orderKey'
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
import { type ChatMappingDeps, normalizeStatus, transformBlocksToParts } from './mappings/ChatMappings'
import { AGENT_TABLES, remapAgentPrefixIds } from './remapAgentPrefixIds'

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
      // Foreign keys are already OFF for the whole migration (MigrationDbService registers
      // it via setPragma), so no per-call toggle here.
      await ctx.db.run(sql.raw('BEGIN'))

      await stageSessionWorkspaces(ctx, this.sourceSchemaInfo)

      for (const statement of importStatements) {
        logger.debug('Executing SQL:', { sql: statement.substring(0, 200) })
        await ctx.db.run(sql.raw(statement))
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
      await backfillAgentOrderKeys(ctx.db)
      await importLegacySessionMessages(ctx.db, this.sourceSchemaInfo, {
        db: ctx.db,
        filesDataDir: ctx.paths.filesDataDir
      })

      await ctx.db.run(sql.raw('COMMIT'))
      committed = true
      logger.info('Agents migration transaction committed successfully')

      // v1 scheduled_tasks → v2 job_schedule + agent_channel_task. Runs while
      // agents_legacy is still attached so the reads can target it directly via
      // ctx.db. Must happen BEFORE remapAgentPrefixIds — schedules carry the
      // legacy agent_id inside their jobInputTemplate JSON, and the remap step
      // rewrites both `agent.id` AND `job_schedule.jobInputTemplate.agentId`.
      await this.migrateScheduledTasksTs(ctx.db)

      // Prefix-id remap runs AFTER the outer COMMIT because it opens its own
      // BEGIN/COMMIT (nested SQLite transactions are not supported). It is
      // idempotent, so a retry after a partial failure is safe.
      await remapAgentPrefixIds(ctx.db)

      // Self-check agent-domain referential integrity after import + remap. FK is OFF for
      // the whole migration, so violations only surface here (and at the engine's final
      // verifyForeignKeys). foreign_key_check is read-only and stays on this connection, so
      // it is safe inside the ATTACH window.
      await this.assertOwnedForeignKeys(ctx.db, AGENT_TABLES)
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
      // v1 has no workspace table. v2 agent_workspace rows are derived from
      // session/agent accessible paths, or a generated default path per session.
      const derivedWorkspaces = await deriveSessionWorkspaces(ctx, this.sourceSchemaInfo)
      const workspaceRows = await ctx.db.all<{ count: number }>(
        sql.raw('SELECT COUNT(*) AS count FROM agent_workspace')
      )
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

      const invalidSessionWorkspaceRows = await ctx.db.all<{ count: number }>(
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

      const targetWorkspacePathCounts = await ctx.db.all<{ path: string; count: number }>(
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

    const v1Tasks = await db.all<V1ScheduledTaskRow>(
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
  workspaceId: string
}

type DerivedSessionWorkspaces = {
  workspaces: DerivedWorkspace[]
  mappings: DerivedSessionWorkspaceMap[]
}

type LegacySessionMessageRow = {
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
  status: MessageStatus
  modelId: string | null
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

async function selectSessionWorkspaceSourceRows(
  db: DbType,
  schemaInfo: AgentsSchemaInfo
): Promise<SessionWorkspaceSourceRow[]> {
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

  return (await db.all(
    sql.raw(
      `SELECT ${columns.join(', ')}
       FROM agents_legacy.sessions AS sessions
       INNER JOIN agents_legacy.agents AS agents ON agents.id = sessions.agent_id
       ORDER BY ${sortOrder} ASC, ${createdAt} ASC, sessions.id ASC`
    )
  )) as SessionWorkspaceSourceRow[]
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
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

function defaultWorkspacePathForSession(agentWorkspacesDir: string, sessionId: string): string {
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || uuidv4()
  return path.join(agentWorkspacesDir, `session-${safeSessionId}`)
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
  const rows = await selectSessionWorkspaceSourceRows(ctx.db, schemaInfo)
  const byPath = new Map<string, DerivedWorkspace>()
  const mappings: DerivedSessionWorkspaceMap[] = []
  const now = Date.now()
  const agentWorkspacesDir = ctx.paths.agentWorkspacesDir

  for (const row of rows) {
    const explicitWorkspacePath =
      extractPrimaryWorkspacePath(row.session_accessible_paths, 'session') ??
      extractPrimaryWorkspacePath(row.agent_accessible_paths, 'agent')
    const workspacePath = explicitWorkspacePath ?? defaultWorkspacePathForSession(agentWorkspacesDir, row.session_id)
    const workspaceType = explicitWorkspacePath ? 'user' : 'system'

    let workspace = byPath.get(workspacePath)
    if (!workspace) {
      const createdAt = legacyTimestampToMs(row.created_at, now)
      workspace = {
        id: uuidv4(),
        name: workspaceNameFromPath(workspacePath),
        path: workspacePath,
        type: workspaceType,
        orderKey: '',
        createdAt,
        updatedAt: legacyTimestampToMs(row.updated_at, createdAt)
      }
      byPath.set(workspacePath, workspace)
    }

    mappings.push({ sessionId: row.session_id, workspaceId: workspace.id })
  }

  const workspaces = assignOrderKeysInSequence(Array.from(byPath.values()))

  return { workspaces, mappings }
}

async function stageSessionWorkspaces(ctx: MigrationContext, schemaInfo: AgentsSchemaInfo): Promise<number> {
  const db = ctx.db
  await db.run(
    sql.raw('CREATE TEMP TABLE IF NOT EXISTS session_workspace_map (session_id TEXT PRIMARY KEY, workspace_id TEXT)')
  )
  await db.run(sql.raw('DELETE FROM session_workspace_map'))

  const derived = await deriveSessionWorkspaces(ctx, schemaInfo)
  for (const workspace of derived.workspaces) {
    await db.run(
      sql`INSERT INTO agent_workspace (id, name, path, type, order_key, created_at, updated_at)
          VALUES (${workspace.id}, ${workspace.name}, ${workspace.path}, ${workspace.type}, ${workspace.orderKey}, ${workspace.createdAt}, ${workspace.updatedAt})`
    )
  }
  for (const mapping of derived.mappings) {
    await db.run(
      sql`INSERT INTO session_workspace_map (session_id, workspace_id) VALUES (${mapping.sessionId}, ${mapping.workspaceId})`
    )
  }

  logger.info('Staged derived session workspaces', {
    workspaces: derived.workspaces.length,
    mappedSessions: derived.mappings.length
  })
  return derived.workspaces.length
}

function selectLegacyMessageColumn(
  schemaInfo: AgentsSchemaInfo,
  column: string,
  alias: string,
  fallbackExpr: string
): string {
  return schemaInfo.session_messages.columns.has(column) ? `${column} AS ${alias}` : `${fallbackExpr} AS ${alias}`
}

function normalizeLegacyRole(value: string | null): MessageRole {
  return value === 'user' || value === 'assistant' || value === 'system' ? value : 'assistant'
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
      status: 'success',
      modelId: null
    }
  }

  const message = parsed && typeof parsed === 'object' ? parsed.message : null
  const blocks = parsed && typeof parsed === 'object' && Array.isArray(parsed.blocks) ? parsed.blocks : []
  if (!message) {
    return {
      role: normalizeLegacyRole(fallbackRole),
      data: { parts: [] },
      status: 'success',
      modelId: null
    }
  }

  const transformed = blocks.length > 0 ? await transformBlocksToParts(blocks, deps) : null
  const parts = transformed?.parts ?? (Array.isArray(message.data?.parts) ? message.data.parts : [])
  return {
    role: normalizeLegacyRole(typeof message.role === 'string' ? message.role : fallbackRole),
    data: { parts },
    status: normalizeStatus(message.status),
    modelId: typeof message.modelId === 'string' && message.modelId.length > 0 ? message.modelId : null
  }
}

async function resolveUserModelId(
  db: DbType,
  cache: Map<string, string | null>,
  rawModelId: string | null
): Promise<string | null> {
  if (!rawModelId) return null
  if (cache.has(rawModelId)) return cache.get(rawModelId) ?? null

  const rows = await db.all<{ id: string }>(
    sql`SELECT id FROM user_model WHERE id = ${rawModelId} OR (provider_id || ':' || model_id) = ${rawModelId} LIMIT 1`
  )
  const resolved = rows[0]?.id ?? null
  cache.set(rawModelId, resolved)
  return resolved
}

export async function importLegacySessionMessages(
  db: DbType,
  schemaInfo: AgentsSchemaInfo,
  deps?: ChatMappingDeps
): Promise<number> {
  if (!schemaInfo.session_messages.exists) return 0

  const selectColumns = [
    selectLegacyMessageColumn(schemaInfo, 'id', 'legacyId', 'NULL'),
    selectLegacyMessageColumn(schemaInfo, 'session_id', 'sessionId', 'NULL'),
    selectLegacyMessageColumn(schemaInfo, 'role', 'role', "'assistant'"),
    selectLegacyMessageColumn(schemaInfo, 'content', 'content', 'NULL'),
    selectLegacyMessageColumn(schemaInfo, 'agent_session_id', 'agentSessionId', 'NULL'),
    selectLegacyMessageColumn(schemaInfo, 'created_at', 'createdAt', 'NULL'),
    selectLegacyMessageColumn(schemaInfo, 'updated_at', 'updatedAt', 'NULL')
  ]
  const orderBy = [
    schemaInfo.session_messages.columns.has('created_at') ? 'created_at ASC' : null,
    schemaInfo.session_messages.columns.has('id') ? 'id ASC' : null
  ]
    .filter(Boolean)
    .join(', ')

  const rows = await db.all<LegacySessionMessageRow>(
    sql.raw(
      `SELECT ${selectColumns.join(', ')}
       FROM agents_legacy.session_messages
       WHERE session_id IN (SELECT id FROM agent_session)
       ${orderBy ? `ORDER BY ${orderBy}` : ''}`
    )
  )
  const modelCache = new Map<string, string | null>()
  let imported = 0

  for (const row of rows) {
    if (!row.sessionId) continue
    let normalized: NormalizedLegacySessionMessage
    try {
      normalized = await normalizeLegacySessionMessage(row.content, row.role, deps)
    } catch (error) {
      normalized = {
        role: normalizeLegacyRole(row.role),
        data: { parts: [] },
        status: 'error',
        modelId: null
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
    await db.insert(agentSessionMessageTable).values({
      id: uuidv7(),
      sessionId: row.sessionId,
      role: normalized.role,
      data: normalized.data,
      status: normalized.status,
      modelId: await resolveUserModelId(db, modelCache, normalized.modelId),
      runtimeResumeToken: row.agentSessionId,
      createdAt,
      updatedAt
    })
    imported++
  }

  logger.info('Imported legacy agent session messages with UUID ids', { imported })
  return imported
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
    for (const agent of assignOrderKeysInSequence(agents)) {
      await db.run(sql`UPDATE agent SET order_key = ${agent.orderKey} WHERE id = ${agent.id}`)
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

  const stampedSessions = assignOrderKeysByScope(sessions, (row) => row.agent_id)
  for (const session of stampedSessions) {
    await db.run(sql`UPDATE agent_session SET order_key = ${session.orderKey} WHERE id = ${session.id}`)
  }
  const agentCount = new Set(sessions.map((row) => row.agent_id)).size
  logger.info(`Backfilled ${sessions.length} session order keys across ${agentCount} agents`)
}
