export type AgentsSourceTableName =
  | 'agents'
  | 'sessions'
  | 'skills'
  | 'scheduled_tasks'
  | 'task_run_logs'
  | 'channels'
  | 'channel_task_subscriptions'
  | 'session_messages'

export type AgentsTableRowCounts = Record<AgentsSourceTableName, number>

export type AgentsColumnExpr = string | { name: string; expr: string }

export type AgentsTableMigrationSpec = {
  sourceTable: AgentsSourceTableName
  targetTable:
    | 'agents_agents'
    | 'agents_sessions'
    | 'agents_skills'
    | 'agents_tasks'
    | 'agents_task_run_logs'
    | 'agents_channels'
    | 'agents_channel_task_subscriptions'
    | 'agents_session_messages'
  columns: readonly AgentsColumnExpr[]
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
      'sort_order',
      { name: 'created_at', expr: "CAST(strftime('%s', created_at) AS INTEGER) * 1000" },
      { name: 'updated_at', expr: "CAST(strftime('%s', updated_at) AS INTEGER) * 1000" }
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
      'slash_commands',
      'configuration',
      'sort_order',
      { name: 'created_at', expr: "CAST(strftime('%s', created_at) AS INTEGER) * 1000" },
      { name: 'updated_at', expr: "CAST(strftime('%s', updated_at) AS INTEGER) * 1000" }
    ]
  },
  {
    sourceTable: 'skills',
    targetTable: 'agents_skills',
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
      { name: 'created_at', expr: "CAST(strftime('%s', created_at) AS INTEGER) * 1000" },
      { name: 'updated_at', expr: "CAST(strftime('%s', updated_at) AS INTEGER) * 1000" }
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
      { name: 'created_at', expr: "CAST(strftime('%s', run_at) AS INTEGER) * 1000" },
      { name: 'updated_at', expr: "CAST(strftime('%s', run_at) AS INTEGER) * 1000" }
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
    ]
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
      { name: 'created_at', expr: "CAST(strftime('%s', created_at) AS INTEGER) * 1000" },
      { name: 'updated_at', expr: "CAST(strftime('%s', updated_at) AS INTEGER) * 1000" }
    ]
  }
] as const

export function getAgentsSourceTableNames(): AgentsSourceTableName[] {
  return AGENTS_TABLE_MIGRATION_SPECS.map((spec) => spec.sourceTable)
}

export function getTotalAgentsRowCount(counts: Partial<AgentsTableRowCounts>): number {
  return getAgentsSourceTableNames().reduce((total, tableName) => total + (counts[tableName] ?? 0), 0)
}

export function quoteSqlitePath(path: string): string {
  return `'${path.replaceAll("'", "''")}'`
}

export function buildAgentsImportStatements(dbPath: string): string[] {
  const statements = [`ATTACH DATABASE ${quoteSqlitePath(dbPath)} AS agents_legacy`]

  for (const spec of AGENTS_TABLE_MIGRATION_SPECS) {
    const insertCols = spec.columns.map((col) => (typeof col === 'string' ? col : col.name)).join(', ')
    const selectCols = spec.columns
      .map((col) => (typeof col === 'string' ? col : `${col.expr} AS ${col.name}`))
      .join(', ')
    statements.push(
      `INSERT INTO ${spec.targetTable} (${insertCols}) SELECT ${selectCols} FROM agents_legacy.${spec.sourceTable}`
    )
  }

  statements.push('DETACH DATABASE agents_legacy')
  return statements
}
