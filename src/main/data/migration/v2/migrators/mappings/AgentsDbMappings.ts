export type AgentsSourceTableName =
  | 'agents'
  | 'sessions'
  | 'skills'
  | 'agent_skills'
  | 'scheduled_tasks'
  | 'task_run_logs'
  | 'channels'
  | 'channel_task_subscriptions'
  | 'session_messages'

export type AgentsTableRowCounts = Record<AgentsSourceTableName, number>

export type AgentsTableSchema = {
  exists: boolean
  columns: Set<string>
}

export type AgentsSchemaInfo = Record<AgentsSourceTableName, AgentsTableSchema>

export type AgentsColumnExpr =
  | string
  | {
      name: string
      expr: string
      sourceColumn?: string
      fallbackExpr?: string
    }

export type AgentsTableMigrationSpec = {
  sourceTable: AgentsSourceTableName
  targetTable:
    | 'agent'
    | 'agent_session'
    | 'agent_global_skill'
    | 'agent_skill'
    | 'agent_task'
    | 'agent_task_run_log'
    | 'agent_channel'
    | 'agent_channel_task'
    | 'agent_session_message'
  columns: readonly AgentsColumnExpr[]
  /** Optional WHERE clause appended to the SELECT to filter source rows */
  whereClause?: string
}

export const AGENTS_TABLE_MIGRATION_SPECS: readonly AgentsTableMigrationSpec[] = [
  {
    sourceTable: 'agents',
    targetTable: 'agent',
    columns: [
      'id',
      'type',
      'name',
      'description',
      'accessible_paths',
      'instructions',
      'model',
      'plan_model',
      'small_model',
      'mcps',
      'allowed_tools',
      'configuration',
      { name: 'sort_order', expr: 'sort_order', fallbackExpr: '0' },
      {
        name: 'deleted_at',
        expr: "CASE WHEN deleted_at IS NULL THEN NULL ELSE CAST(strftime('%s', deleted_at) AS INTEGER) * 1000 END",
        sourceColumn: 'deleted_at'
      },
      {
        name: 'created_at',
        expr: "CAST(strftime('%s', created_at) AS INTEGER) * 1000",
        sourceColumn: 'created_at'
      },
      {
        name: 'updated_at',
        expr: "CAST(strftime('%s', updated_at) AS INTEGER) * 1000",
        sourceColumn: 'updated_at'
      }
    ]
  },
  {
    sourceTable: 'sessions',
    targetTable: 'agent_session',
    columns: [
      'id',
      'agent_type',
      'agent_id',
      'name',
      'description',
      'accessible_paths',
      'instructions',
      'model',
      'plan_model',
      'small_model',
      'mcps',
      'allowed_tools',
      { name: 'slash_commands', expr: 'slash_commands' },
      'configuration',
      { name: 'sort_order', expr: 'sort_order', fallbackExpr: '0' },
      {
        name: 'created_at',
        expr: "CAST(strftime('%s', created_at) AS INTEGER) * 1000",
        sourceColumn: 'created_at'
      },
      {
        name: 'updated_at',
        expr: "CAST(strftime('%s', updated_at) AS INTEGER) * 1000",
        sourceColumn: 'updated_at'
      }
    ],
    // Exclude sessions whose agent no longer exists — they would fail the
    // post-migration PRAGMA foreign_key_check (agents_sessions.agent_id →
    // agents_agents.id) and cause the entire migration to be marked failed.
    whereClause: 'agent_id IN (SELECT id FROM agents_legacy.agents)'
  },
  {
    sourceTable: 'skills',
    targetTable: 'agent_global_skill',
    columns: [
      'id',
      'name',
      'description',
      'folder_name',
      'source',
      'source_url',
      'namespace',
      'author',
      'tags',
      'content_hash',
      'is_enabled',
      'created_at',
      'updated_at'
    ]
  },
  {
    sourceTable: 'agent_skills',
    targetTable: 'agent_skill',
    columns: [
      { name: 'agent_id', expr: 'agent_id' },
      { name: 'skill_id', expr: 'skill_id' },
      { name: 'is_enabled', expr: 'is_enabled' },
      'created_at',
      'updated_at'
    ],
    // Only import agent_skill rows whose agent and skill were both successfully
    // migrated; orphaned rows would fail the FK checks.
    whereClause: 'agent_id IN (SELECT id FROM agent) AND skill_id IN (SELECT id FROM agent_global_skill)'
  },
  {
    sourceTable: 'scheduled_tasks',
    targetTable: 'agent_task',
    columns: [
      'id',
      'agent_id',
      'name',
      'prompt',
      'schedule_type',
      'schedule_value',
      'timeout_minutes',
      {
        name: 'next_run',
        expr: "CASE WHEN next_run IS NULL THEN NULL ELSE CAST(strftime('%s', next_run) AS INTEGER) * 1000 END",
        sourceColumn: 'next_run'
      },
      {
        name: 'last_run',
        expr: "CASE WHEN last_run IS NULL THEN NULL ELSE CAST(strftime('%s', last_run) AS INTEGER) * 1000 END",
        sourceColumn: 'last_run'
      },
      'last_result',
      'status',
      {
        name: 'created_at',
        expr: "CAST(strftime('%s', created_at) AS INTEGER) * 1000",
        sourceColumn: 'created_at'
      },
      {
        name: 'updated_at',
        expr: "CAST(strftime('%s', updated_at) AS INTEGER) * 1000",
        sourceColumn: 'updated_at'
      }
    ],
    // Only import tasks whose agent was successfully migrated; orphaned rows
    // would fail the FK check on agent_task.agent_id → agent.id.
    whereClause: 'agent_id IN (SELECT id FROM agent)'
  },
  {
    sourceTable: 'task_run_logs',
    targetTable: 'agent_task_run_log',
    columns: [
      'id',
      'task_id',
      'session_id',
      {
        name: 'run_at',
        expr: "CAST(strftime('%s', run_at) AS INTEGER) * 1000",
        sourceColumn: 'run_at'
      },
      'duration_ms',
      'status',
      'result',
      'error',
      {
        name: 'created_at',
        expr: "CAST(strftime('%s', run_at) AS INTEGER) * 1000",
        sourceColumn: 'run_at'
      },
      {
        name: 'updated_at',
        expr: "CAST(strftime('%s', run_at) AS INTEGER) * 1000",
        sourceColumn: 'run_at'
      }
    ],
    // Only import logs whose task was successfully migrated; orphaned rows
    // would fail the FK check on agent_task_run_log.task_id → agent_task.id.
    whereClause: 'task_id IN (SELECT id FROM agent_task)'
  },
  {
    sourceTable: 'channels',
    targetTable: 'agent_channel',
    columns: [
      'id',
      'type',
      'name',
      'agent_id',
      'session_id',
      'config',
      'is_active',
      'active_chat_ids',
      'permission_mode',
      'created_at',
      'updated_at'
    ],
    // Channels reference agent and agent_session via FK; skip any channel whose
    // agent was deleted or whose session was filtered out.
    whereClause:
      '(agent_id IS NULL OR agent_id IN (SELECT id FROM agents_legacy.agents)) AND ' +
      '(session_id IS NULL OR session_id IN (SELECT id FROM agent_session))'
  },
  {
    sourceTable: 'channel_task_subscriptions',
    targetTable: 'agent_channel_task',
    columns: ['channel_id', 'task_id'],
    // Only import subscriptions whose channel and task were both successfully
    // migrated; orphaned rows would fail the FK checks.
    whereClause: 'channel_id IN (SELECT id FROM agent_channel) AND task_id IN (SELECT id FROM agent_task)'
  },
  {
    sourceTable: 'session_messages',
    targetTable: 'agent_session_message',
    columns: [
      'id',
      'session_id',
      'role',
      'content',
      'agent_session_id',
      'metadata',
      {
        name: 'created_at',
        expr: "CAST(strftime('%s', created_at) AS INTEGER) * 1000",
        sourceColumn: 'created_at'
      },
      {
        name: 'updated_at',
        expr: "CAST(strftime('%s', updated_at) AS INTEGER) * 1000",
        sourceColumn: 'updated_at'
      }
    ],
    // Only import messages whose session was successfully migrated; messages
    // referencing a filtered-out session would fail the FK check.
    whereClause: 'session_id IN (SELECT id FROM agent_session)'
  }
] as const

export function getAgentsSourceTableNames(): AgentsSourceTableName[] {
  return AGENTS_TABLE_MIGRATION_SPECS.map((spec) => spec.sourceTable)
}

export function createEmptyAgentsSchemaInfo(): AgentsSchemaInfo {
  return Object.fromEntries(
    getAgentsSourceTableNames().map((tableName) => [tableName, { exists: false, columns: new Set<string>() }])
  ) as AgentsSchemaInfo
}

export function getTotalAgentsRowCount(counts: Partial<AgentsTableRowCounts>): number {
  return getAgentsSourceTableNames().reduce((total, tableName) => total + (counts[tableName] ?? 0), 0)
}

export function quoteSqlitePath(path: string): string {
  return `'${path.replaceAll("'", "''")}'`
}

function resolveColumnSelection(column: AgentsColumnExpr, sourceColumns: Set<string>) {
  if (typeof column === 'string') {
    return sourceColumns.has(column) ? { insert: column, select: column } : null
  }

  const sourceColumn = column.sourceColumn ?? column.name
  if (sourceColumns.has(sourceColumn)) {
    return {
      insert: column.name,
      select: column.expr === column.name ? column.expr : `${column.expr} AS ${column.name}`
    }
  }

  if (column.fallbackExpr) {
    return {
      insert: column.name,
      select: `${column.fallbackExpr} AS ${column.name}`
    }
  }

  return null
}

export function buildAgentsImportStatements(dbPath: string, schemaInfo: AgentsSchemaInfo): string[] {
  const statements = [`ATTACH DATABASE ${quoteSqlitePath(dbPath)} AS agents_legacy`]

  for (const spec of AGENTS_TABLE_MIGRATION_SPECS) {
    const sourceSchema = schemaInfo[spec.sourceTable]
    if (!sourceSchema.exists) {
      continue
    }

    const resolvedColumns = spec.columns
      .map((column) => resolveColumnSelection(column, sourceSchema.columns))
      .filter((column) => column !== null)

    if (resolvedColumns.length === 0) {
      continue
    }

    const whereClause = spec.whereClause ? ` WHERE ${spec.whereClause}` : ''
    statements.push(
      `INSERT INTO ${spec.targetTable} (${resolvedColumns.map((column) => column.insert).join(', ')}) ` +
        `SELECT ${resolvedColumns.map((column) => column.select).join(', ')} FROM agents_legacy.${spec.sourceTable}${whereClause}`
    )
  }

  statements.push('DETACH DATABASE agents_legacy')
  return statements
}
