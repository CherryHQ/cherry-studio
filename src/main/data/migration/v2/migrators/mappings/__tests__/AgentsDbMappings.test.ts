import { describe, expect, it } from 'vitest'

import {
  AGENTS_TABLE_MIGRATION_SPECS,
  buildAgentsImportStatements,
  getAgentsSourceTableNames,
  getTotalAgentsRowCount,
  quoteSqlitePath
} from '../AgentsDbMappings'

describe('AgentsDbMappings', () => {
  it('builds attach/import/detach statements for the legacy agents db', () => {
    const statements = buildAgentsImportStatements("/tmp/agent's.db")

    expect(statements[0]).toBe("ATTACH DATABASE '/tmp/agent''s.db' AS agents_legacy")
    expect(statements).toContain(
      "INSERT INTO agents_agents (id, type, name, description, accessible_paths, instructions, model, plan_model, small_model, mcps, allowed_tools, configuration, sort_order, created_at, updated_at) SELECT id, type, name, description, accessible_paths, instructions, model, plan_model, small_model, mcps, allowed_tools, configuration, sort_order, CAST(strftime('%s', created_at) AS INTEGER) * 1000 AS created_at, CAST(strftime('%s', updated_at) AS INTEGER) * 1000 AS updated_at FROM agents_legacy.agents"
    )
    expect(statements.at(-1)).toBe('DETACH DATABASE agents_legacy')
  })

  it('exposes all source table names in dependency order', () => {
    expect(getAgentsSourceTableNames()).toEqual([
      'agents',
      'sessions',
      'skills',
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
        scheduled_tasks: 5,
        task_run_logs: 6,
        channels: 7,
        channel_task_subscriptions: 8,
        session_messages: 9
      })
    ).toBe(44)
  })

  it('keeps the table spec list aligned with the source table names', () => {
    expect(AGENTS_TABLE_MIGRATION_SPECS.map((spec) => spec.sourceTable)).toEqual(getAgentsSourceTableNames())
  })

  it('quotes sqlite file paths safely', () => {
    expect(quoteSqlitePath("/tmp/a'b/c.db")).toBe("'/tmp/a''b/c.db'")
  })
})
