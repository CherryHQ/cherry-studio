import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'

// Catch migration-forward data loss in databases created before the association column existed.
describe('Session worktree migrate-forward', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0038_damp_leader' })
  it('preserves populated sessions and their original workspace', () => {
    dbh.sqlite
      .prepare(
        "INSERT INTO agent_workspace (id, path, name, type, order_key, created_at, updated_at) VALUES ('workspace', '/repo', 'Repo', 'user', 'a0', 1, 1)"
      )
      .run()
    dbh.sqlite
      .prepare(
        "INSERT INTO agent_session (id, name, workspace_id, order_key, last_activity_at, created_at, updated_at) VALUES ('session', 'Existing', 'workspace', 'a0', 1, 1, 1)"
      )
      .run()
    applyMigrations(dbh.db, resolveMigrationsPath())
    expect(dbh.sqlite.prepare('SELECT id, name, workspace_id, worktree FROM agent_session').all()).toEqual([
      { id: 'session', name: 'Existing', workspace_id: 'workspace', worktree: null }
    ])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})
