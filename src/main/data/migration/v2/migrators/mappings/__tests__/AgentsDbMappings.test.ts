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
      "INSERT INTO agents_agents (id, type, name, description, accessible_paths, instructions, model, plan_model, small_model, mcps, allowed_tools, configuration, sort_order, deleted_at, created_at, updated_at) SELECT id, type, name, description, accessible_paths, instructions, model, plan_model, small_model, mcps, allowed_tools, configuration, sort_order, deleted_at, CAST(strftime('%s', created_at) AS INTEGER) * 1000 AS created_at, CAST(strftime('%s', updated_at) AS INTEGER) * 1000 AS updated_at FROM agents_legacy.agents"
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
      "INSERT INTO agents_agents (id, type, name, description, accessible_paths, instructions, model, plan_model, small_model, mcps, allowed_tools, configuration, sort_order, created_at, updated_at) SELECT id, type, name, description, accessible_paths, instructions, model, plan_model, small_model, mcps, allowed_tools, configuration, 0 AS sort_order, CAST(strftime('%s', created_at) AS INTEGER) * 1000 AS created_at, CAST(strftime('%s', updated_at) AS INTEGER) * 1000 AS updated_at FROM agents_legacy.agents"
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
    const sessionsInsert = statements.find((s) => s.includes('agents_sessions'))

    expect(sessionsInsert).toContain('WHERE agent_id IN (SELECT id FROM agents_legacy.agents)')
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
    const messagesInsert = statements.find((s) => s.includes('agents_session_messages'))

    expect(messagesInsert).toContain('WHERE session_id IN (SELECT id FROM agents_sessions)')
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
    const channelsInsert = statements.find((s) => s.includes('agents_channels'))

    expect(channelsInsert).toContain('(agent_id IS NULL OR agent_id IN (SELECT id FROM agents_legacy.agents))')
    expect(channelsInsert).toContain('(session_id IS NULL OR session_id IN (SELECT id FROM agents_sessions))')
  })

  it('maps agent_skills → agents_agent_skills with FK-safe WHERE clause', () => {
    const schemaInfo = createEmptyAgentsSchemaInfo()
    schemaInfo.agent_skills.exists = true
    schemaInfo.agent_skills.columns = new Set(['agent_id', 'skill_id', 'is_enabled', 'created_at', 'updated_at'])

    const statements = buildAgentsImportStatements('/tmp/agents.db', schemaInfo)
    const agentSkillsInsert = statements.find((s) => s.includes('agents_agent_skills'))

    expect(agentSkillsInsert).toContain(
      'INSERT INTO agents_agent_skills (agent_id, skill_id, is_enabled, created_at, updated_at)'
    )
    expect(agentSkillsInsert).toContain('FROM agents_legacy.agent_skills')
    expect(agentSkillsInsert).toContain('WHERE agent_id IN (SELECT id FROM agents_agents)')
    expect(agentSkillsInsert).toContain('AND skill_id IN (SELECT id FROM agents_global_skills)')
  })

  it('maps skills → agents_global_skills', () => {
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
    const skillsInsert = statements.find((s) => s.includes('agents_global_skills'))

    expect(skillsInsert).toContain('INSERT INTO agents_global_skills')
    expect(skillsInsert).toContain('FROM agents_legacy.skills')
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
})
