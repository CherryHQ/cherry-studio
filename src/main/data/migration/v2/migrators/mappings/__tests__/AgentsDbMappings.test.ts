import { describe, expect, it } from 'vitest'

import { getTotalAgentsRowCount, quoteSqlitePath } from '../AgentsDbMappings'

describe('AgentsDbMappings', () => {
  // Note: `scheduled_tasks`, `task_run_logs`, and `channel_task_subscriptions`
  // are no longer in AGENTS_TABLE_MIGRATION_SPECS — they migrate via the
  // TypeScript loop `AgentsMigrator.migrateScheduledTasksTs`. The FK-safe
  // WHERE clauses are still applied inline by that loop's SQL queries.

  it('sums row counts across all importStatement-driven tables', () => {
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
    ).toBe(32)
  })

  it('quotes sqlite file paths safely', () => {
    expect(quoteSqlitePath("/tmp/a'b/c.db")).toBe("'/tmp/a''b/c.db'")
  })

  // Regression: legacy agents.db allowed NULL on columns that the new schema
  // declares NOT NULL with a SQL default (e.g. agent.mcps DEFAULT '[]').
  // INSERT...SELECT bypasses column defaults when the column is named in the
  // INSERT list, so a SELECT of NULL trips SQLITE_CONSTRAINT_NOTNULL. The
  // mapping must wrap such columns in COALESCE(<col>, <default>).
})
