import { describe, expect, it } from 'vitest'

import {
  AGENTS_TABLE_MIGRATION_SPECS,
  buildAgentsImportStatements,
  createEmptyAgentsSchemaInfo,
  getAgentsSourceTableNames,
  getTotalAgentsRowCount,
  quoteSqlitePath
} from '../AgentsDbMappings'

describe('AgentsDbMappings', () => {
  it('builds attach/import/detach statements for the legacy agents db', () => {
    const schemaInfo = createEmptyAgentsSchemaInfo()
    schemaInfo.agents.exists = true
    schemaInfo.agents.columns = new Set([
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
      'deleted_at',
      'created_at',
      'updated_at'
    ])

    const statements = buildAgentsImportStatements("/tmp/agent's.db", schemaInfo)

    expect(statements[0]).toBe("ATTACH DATABASE '/tmp/agent''s.db' AS agents_legacy")
    expect(statements).toContain(
      "INSERT INTO agent (id, type, name, description, accessible_paths, instructions, model, plan_model, small_model, mcps, allowed_tools, configuration, sort_order, deleted_at, created_at, updated_at) SELECT id, type, name, COALESCE(description, '') AS description, COALESCE(accessible_paths, '[]') AS accessible_paths, instructions, model, plan_model, small_model, COALESCE(mcps, '[]') AS mcps, COALESCE(allowed_tools, '[]') AS allowed_tools, COALESCE(configuration, '{}') AS configuration, COALESCE(sort_order, 0) AS sort_order, CASE WHEN deleted_at IS NULL THEN NULL ELSE CAST(strftime('%s', deleted_at) AS INTEGER) * 1000 END AS deleted_at, CAST(strftime('%s', created_at) AS INTEGER) * 1000 AS created_at, CAST(strftime('%s', updated_at) AS INTEGER) * 1000 AS updated_at FROM agents_legacy.agents"
    )
    expect(statements.at(-1)).toBe('DETACH DATABASE agents_legacy')
  })

  it('falls back to defaults and skips missing tables for older legacy schemas', () => {
    const schemaInfo = createEmptyAgentsSchemaInfo()
    schemaInfo.agents.exists = true
    schemaInfo.agents.columns = new Set([
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
      'created_at',
      'updated_at'
      // deleted_at intentionally absent — older schema without soft-delete
    ])

    const statements = buildAgentsImportStatements('/tmp/agents.db', schemaInfo)

    // deleted_at absent from source → skipped in INSERT (resolveColumnSelection returns null)
    expect(statements).toContain(
      "INSERT INTO agent (id, type, name, description, accessible_paths, instructions, model, plan_model, small_model, mcps, allowed_tools, configuration, sort_order, created_at, updated_at) SELECT id, type, name, COALESCE(description, '') AS description, COALESCE(accessible_paths, '[]') AS accessible_paths, instructions, model, plan_model, small_model, COALESCE(mcps, '[]') AS mcps, COALESCE(allowed_tools, '[]') AS allowed_tools, COALESCE(configuration, '{}') AS configuration, 0 AS sort_order, CAST(strftime('%s', created_at) AS INTEGER) * 1000 AS created_at, CAST(strftime('%s', updated_at) AS INTEGER) * 1000 AS updated_at FROM agents_legacy.agents"
    )
    expect(statements.some((statement) => statement.includes('agents_legacy.skills'))).toBe(false)
  })

  it('appends WHERE clause for sessions to exclude orphaned agent references', () => {
    const schemaInfo = createEmptyAgentsSchemaInfo()
    schemaInfo.sessions.exists = true
    schemaInfo.sessions.columns = new Set([
      'id',
      'agent_type',
      'agent_id',
      'name',
      'model',
      'sort_order',
      'created_at',
      'updated_at'
    ])

    const statements = buildAgentsImportStatements('/tmp/agents.db', schemaInfo)
    const sessionsInsert = statements.find((s) => s.startsWith('INSERT INTO agent_session '))

    expect(sessionsInsert).toContain('WHERE agent_id IN (SELECT id FROM agent)')
  })

  it('appends WHERE clause for session_messages to match migrated sessions only', () => {
    const schemaInfo = createEmptyAgentsSchemaInfo()
    schemaInfo.session_messages.exists = true
    schemaInfo.session_messages.columns = new Set([
      'id',
      'session_id',
      'role',
      'content',
      'agent_session_id',
      'metadata',
      'created_at',
      'updated_at'
    ])

    const statements = buildAgentsImportStatements('/tmp/agents.db', schemaInfo)
    const messagesInsert = statements.find((s) => s.startsWith('INSERT INTO agent_session_message '))

    expect(messagesInsert).toContain('WHERE session_id IN (SELECT id FROM agent_session)')
  })

  it('appends WHERE clause for channels to exclude orphaned agent and session references', () => {
    const schemaInfo = createEmptyAgentsSchemaInfo()
    schemaInfo.channels.exists = true
    schemaInfo.channels.columns = new Set([
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
    ])

    const statements = buildAgentsImportStatements('/tmp/agents.db', schemaInfo)
    const channelsInsert = statements.find((s) => s.startsWith('INSERT INTO agent_channel '))

    expect(channelsInsert).toContain('(agent_id IS NULL OR agent_id IN (SELECT id FROM agent))')
    expect(channelsInsert).toContain('(session_id IS NULL OR session_id IN (SELECT id FROM agent_session))')
  })

  it('maps agent_skills → agent_skill with FK-safe WHERE clause', () => {
    const schemaInfo = createEmptyAgentsSchemaInfo()
    schemaInfo.agent_skills.exists = true
    schemaInfo.agent_skills.columns = new Set(['agent_id', 'skill_id', 'is_enabled', 'created_at', 'updated_at'])

    const statements = buildAgentsImportStatements('/tmp/agents.db', schemaInfo)
    const agentSkillsInsert = statements.find((s) => s.startsWith('INSERT INTO agent_skill '))

    expect(agentSkillsInsert).toContain(
      'INSERT INTO agent_skill (agent_id, skill_id, is_enabled, created_at, updated_at)'
    )
    expect(agentSkillsInsert).toContain('FROM agents_legacy.agent_skills')
    expect(agentSkillsInsert).toContain('WHERE agent_id IN (SELECT id FROM agent)')
    expect(agentSkillsInsert).toContain('AND skill_id IN (SELECT id FROM agent_global_skill)')
  })

  it('maps skills → agent_global_skill', () => {
    const schemaInfo = createEmptyAgentsSchemaInfo()
    schemaInfo.skills.exists = true
    schemaInfo.skills.columns = new Set([
      'id',
      'name',
      'folder_name',
      'source',
      'content_hash',
      'is_enabled',
      'created_at',
      'updated_at'
    ])

    const statements = buildAgentsImportStatements('/tmp/agents.db', schemaInfo)
    const skillsInsert = statements.find((s) => s.startsWith('INSERT INTO agent_global_skill '))

    expect(skillsInsert).toContain('INSERT INTO agent_global_skill')
    expect(skillsInsert).toContain('FROM agents_legacy.skills')
  })

  it('appends FK-safe WHERE clause for scheduled_tasks', () => {
    const schemaInfo = createEmptyAgentsSchemaInfo()
    schemaInfo.scheduled_tasks.exists = true
    schemaInfo.scheduled_tasks.columns = new Set([
      'id',
      'agent_id',
      'name',
      'prompt',
      'schedule_type',
      'schedule_value',
      'timeout_minutes',
      'status',
      'created_at',
      'updated_at'
    ])

    const statements = buildAgentsImportStatements('/tmp/agents.db', schemaInfo)
    const tasksInsert = statements.find((s) => s.startsWith('INSERT INTO agent_task '))

    expect(tasksInsert).toContain('WHERE agent_id IN (SELECT id FROM agent)')
  })

  it('appends FK-safe WHERE clause for task_run_logs', () => {
    const schemaInfo = createEmptyAgentsSchemaInfo()
    schemaInfo.task_run_logs.exists = true
    schemaInfo.task_run_logs.columns = new Set([
      'id',
      'task_id',
      'session_id',
      'run_at',
      'duration_ms',
      'status',
      'result',
      'error'
    ])

    const statements = buildAgentsImportStatements('/tmp/agents.db', schemaInfo)
    const logsInsert = statements.find((s) => s.startsWith('INSERT INTO agent_task_run_log '))

    expect(logsInsert).toContain('WHERE task_id IN (SELECT id FROM agent_task)')
  })

  it('appends FK-safe WHERE clause for channel_task_subscriptions', () => {
    const schemaInfo = createEmptyAgentsSchemaInfo()
    schemaInfo.channel_task_subscriptions.exists = true
    schemaInfo.channel_task_subscriptions.columns = new Set(['channel_id', 'task_id'])

    const statements = buildAgentsImportStatements('/tmp/agents.db', schemaInfo)
    const subsInsert = statements.find((s) => s.startsWith('INSERT INTO agent_channel_task '))

    expect(subsInsert).toContain(
      'WHERE channel_id IN (SELECT id FROM agent_channel) AND task_id IN (SELECT id FROM agent_task)'
    )
  })

  it('exposes all source table names in dependency order', () => {
    expect(getAgentsSourceTableNames()).toEqual([
      'agents',
      'sessions',
      'skills',
      'agent_skills',
      'scheduled_tasks',
      'task_run_logs',
      'channels',
      'channel_task_subscriptions',
      'session_messages'
    ])
  })

  it('sums row counts across all tables', () => {
    expect(
      getTotalAgentsRowCount({
        agents: 2,
        sessions: 3,
        skills: 4,
        agent_skills: 5,
        scheduled_tasks: 6,
        task_run_logs: 7,
        channels: 8,
        channel_task_subscriptions: 9,
        session_messages: 10
      })
    ).toBe(54)
  })

  it('keeps the table spec list aligned with the source table names', () => {
    expect(AGENTS_TABLE_MIGRATION_SPECS.map((spec) => spec.sourceTable)).toEqual(getAgentsSourceTableNames())
  })

  it('quotes sqlite file paths safely', () => {
    expect(quoteSqlitePath("/tmp/a'b/c.db")).toBe("'/tmp/a''b/c.db'")
  })

  // Regression: legacy agents.db allowed NULL on columns that the new schema
  // declares NOT NULL with a SQL default (e.g. agent.mcps DEFAULT '[]').
  // INSERT...SELECT bypasses column defaults when the column is named in the
  // INSERT list, so a SELECT of NULL trips SQLITE_CONSTRAINT_NOTNULL. The
  // mapping must wrap such columns in COALESCE(<col>, <default>).
  it('wraps NOT NULL target columns in COALESCE so legacy NULLs fall back to schema defaults', () => {
    const schemaInfo = createEmptyAgentsSchemaInfo()
    schemaInfo.agents.exists = true
    schemaInfo.agents.columns = new Set([
      'id',
      'type',
      'name',
      'description',
      'accessible_paths',
      'instructions',
      'model',
      'mcps',
      'allowed_tools',
      'configuration',
      'sort_order',
      'created_at',
      'updated_at'
    ])
    schemaInfo.sessions.exists = true
    schemaInfo.sessions.columns = new Set([
      'id',
      'agent_type',
      'agent_id',
      'name',
      'description',
      'accessible_paths',
      'instructions',
      'model',
      'mcps',
      'allowed_tools',
      'slash_commands',
      'configuration',
      'sort_order',
      'created_at',
      'updated_at'
    ])
    schemaInfo.skills.exists = true
    schemaInfo.skills.columns = new Set([
      'id',
      'name',
      'folder_name',
      'source',
      'tags',
      'content_hash',
      'is_enabled',
      'created_at',
      'updated_at'
    ])
    schemaInfo.agent_skills.exists = true
    schemaInfo.agent_skills.columns = new Set(['agent_id', 'skill_id', 'is_enabled', 'created_at', 'updated_at'])
    schemaInfo.scheduled_tasks.exists = true
    schemaInfo.scheduled_tasks.columns = new Set([
      'id',
      'agent_id',
      'name',
      'prompt',
      'schedule_type',
      'schedule_value',
      'timeout_minutes',
      'status',
      'created_at',
      'updated_at'
    ])
    schemaInfo.channels.exists = true
    schemaInfo.channels.columns = new Set([
      'id',
      'type',
      'name',
      'agent_id',
      'session_id',
      'config',
      'is_active',
      'active_chat_ids',
      'created_at',
      'updated_at'
    ])

    const statements = buildAgentsImportStatements('/tmp/agents.db', schemaInfo)
    const find = (target: string) => statements.find((s) => s.startsWith(`INSERT INTO ${target} `)) ?? ''

    const agentInsert = find('agent')
    expect(agentInsert).toContain("COALESCE(description, '') AS description")
    expect(agentInsert).toContain("COALESCE(accessible_paths, '[]') AS accessible_paths")
    expect(agentInsert).toContain("COALESCE(mcps, '[]') AS mcps")
    expect(agentInsert).toContain("COALESCE(allowed_tools, '[]') AS allowed_tools")
    expect(agentInsert).toContain("COALESCE(configuration, '{}') AS configuration")
    expect(agentInsert).toContain('COALESCE(sort_order, 0) AS sort_order')

    const sessionInsert = find('agent_session')
    expect(sessionInsert).toContain("COALESCE(description, '') AS description")
    expect(sessionInsert).toContain("COALESCE(accessible_paths, '[]') AS accessible_paths")
    expect(sessionInsert).toContain("COALESCE(mcps, '[]') AS mcps")
    expect(sessionInsert).toContain("COALESCE(allowed_tools, '[]') AS allowed_tools")
    expect(sessionInsert).toContain("COALESCE(slash_commands, '[]') AS slash_commands")
    expect(sessionInsert).toContain("COALESCE(configuration, '{}') AS configuration")
    expect(sessionInsert).toContain('COALESCE(sort_order, 0) AS sort_order')

    const skillInsert = find('agent_global_skill')
    expect(skillInsert).toContain("COALESCE(tags, '[]') AS tags")
    // Legacy `skills.is_enabled DEFAULT true`: coalesce to 1, not 0, so a
    // migrated skill that was implicitly enabled does not flip to disabled.
    expect(skillInsert).toContain('COALESCE(is_enabled, 1) AS is_enabled')

    const agentSkillInsert = find('agent_skill')
    expect(agentSkillInsert).toContain('COALESCE(is_enabled, 0) AS is_enabled')

    const taskInsert = find('agent_task')
    expect(taskInsert).toContain('COALESCE(timeout_minutes, 2) AS timeout_minutes')

    const channelInsert = find('agent_channel')
    expect(channelInsert).toContain('COALESCE(is_active, 1) AS is_active')
    expect(channelInsert).toContain("COALESCE(active_chat_ids, '[]') AS active_chat_ids")
    expect(channelInsert).toContain("COALESCE(created_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000) AS created_at")
    expect(channelInsert).toContain("COALESCE(updated_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000) AS updated_at")
  })

  it('matches each notNullCol defaultExpr against the canonical legacy/v2 schema defaults', () => {
    type ColumnDefault = { defaultExpr: string }
    const EXPECTED_DEFAULTS: Record<string, Record<string, ColumnDefault>> = {
      agent: {
        description: { defaultExpr: "''" },
        accessible_paths: { defaultExpr: "'[]'" },
        mcps: { defaultExpr: "'[]'" },
        allowed_tools: { defaultExpr: "'[]'" },
        configuration: { defaultExpr: "'{}'" },
        sort_order: { defaultExpr: '0' }
      },
      agent_session: {
        description: { defaultExpr: "''" },
        accessible_paths: { defaultExpr: "'[]'" },
        mcps: { defaultExpr: "'[]'" },
        allowed_tools: { defaultExpr: "'[]'" },
        slash_commands: { defaultExpr: "'[]'" },
        configuration: { defaultExpr: "'{}'" },
        sort_order: { defaultExpr: '0' }
      },
      agent_global_skill: {
        tags: { defaultExpr: "'[]'" },
        // Legacy `DEFAULT true` (0005_normal_doomsday.sql:12) overrides v2's
        // `default(false)`; preserves user intent on coalesce.
        is_enabled: { defaultExpr: '1' }
      },
      agent_skill: {
        is_enabled: { defaultExpr: '0' }
      },
      agent_task: {
        timeout_minutes: { defaultExpr: '2' }
      },
      agent_channel: {
        is_active: { defaultExpr: '1' },
        active_chat_ids: { defaultExpr: "'[]'" }
      }
    }

    const seen = new Set<string>()
    const NOT_NULL_COL_SHAPE = /^COALESCE\((\w+),\s+('[^']*'|\d+)\)$/

    for (const spec of AGENTS_TABLE_MIGRATION_SPECS) {
      for (const column of spec.columns) {
        if (typeof column === 'string') continue
        const match = column.expr.match(NOT_NULL_COL_SHAPE)
        if (!match) continue
        const [, sourceName, defaultExpr] = match
        if (sourceName !== column.name) continue // safety: source col must equal target name

        const key = `${spec.targetTable}.${column.name}`
        seen.add(key)

        const expected = EXPECTED_DEFAULTS[spec.targetTable]?.[column.name]
        expect(expected, `unexpected notNullCol entry: ${key}`).toBeDefined()
        expect(defaultExpr, `defaultExpr drift on ${key}`).toBe(expected.defaultExpr)
        expect(column.fallbackExpr, `fallbackExpr drift on ${key}`).toBe(expected.defaultExpr)
      }
    }

    // Every entry in EXPECTED_DEFAULTS must be present in the spec — catches the
    // reverse direction (someone deletes a notNullCol without updating expectations).
    for (const [table, cols] of Object.entries(EXPECTED_DEFAULTS)) {
      for (const col of Object.keys(cols)) {
        expect(seen, `missing notNullCol(${col}) on ${table}`).toContain(`${table}.${col}`)
      }
    }
  })
})
