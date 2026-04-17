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
    | 'agents_agents'
    | 'agents_sessions'
    | 'agents_global_skills'
    | 'agents_agent_skills'
    | 'agents_tasks'
    | 'agents_task_run_logs'
    | 'agents_channels'
    | 'agents_channel_task_subscriptions'
    | 'agents_session_messages'
  columns: readonly AgentsColumnExpr[]
  /** Optional WHERE clause appended to the SELECT to filter source rows */
  whereClause?: string
}

export const AGENTS_TABLE_MIGRATION_SPECS: readonly AgentsTableMigrationSpec[] = [
  {
    sourceTable: 'agents',
    targetTable: 'agents_agents',
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
      'deleted_at',
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
    targetTable: 'agents_sessions',
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
    targetTable: 'agents_global_skills',
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
    targetTable: 'agents_agent_skills',
    columns: [
      { name: 'agent_id', expr: 'agent_id' },
      { name: 'skill_id', expr: 'skill_id' },
      { name: 'is_enabled', expr: 'is_enabled' },
      'created_at',
      'updated_at'
    ],
    // Only import agent_skill rows whose agent and skill were both successfully
    // migrated; orphaned rows would fail the FK checks.
    whereClause: 'agent_id IN (SELECT id FROM agents_agents) AND skill_id IN (SELECT id FROM agents_global_skills)'
  },
  {
    sourceTable: 'scheduled_tasks',
    targetTable: 'agents_tasks',
    columns: [
      'id',
      'agent_id',
      'name',
      'prompt',
      'schedule_type',
      'schedule_value',
      'timeout_minutes',
      'next_run',
      'last_run',
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
    ]
  },
  {
    sourceTable: 'task_run_logs',
    targetTable: 'agents_task_run_logs',
    columns: [
      'id',
      'task_id',
      'session_id',
      'run_at',
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
    ]
  },
  {
    sourceTable: 'channels',
    targetTable: 'agents_channels',
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
    // Channels reference agents_agents and agents_sessions via FK; skip any
    // channel whose agent was deleted or whose session was filtered out.
    whereClause:
      '(agent_id IS NULL OR agent_id IN (SELECT id FROM agents_legacy.agents)) AND ' +
      '(session_id IS NULL OR session_id IN (SELECT id FROM agents_sessions))'
  },
  {
    sourceTable: 'channel_task_subscriptions',
    targetTable: 'agents_channel_task_subscriptions',
    columns: ['channel_id', 'task_id']
  },
  {
    sourceTable: 'session_messages',
    targetTable: 'agents_session_messages',
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
    whereClause: 'session_id IN (SELECT id FROM agents_sessions)'
  }
] as const

export const AGENTS_TARGET_TABLE_DELETE_ORDER = [
  'agents_session_messages',
  'agents_channel_task_subscriptions',
  'agents_task_run_logs',
  'agents_channels',
  'agents_tasks',
  'agents_agent_skills',
  'agents_sessions',
  'agents_global_skills',
  'agents_agents'
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
