import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'

import { AgentSessionRuntimeSeeder } from '../AgentSessionRuntimeSeeder'

// Catch upgrading an installed database losing its original engine before the binding is saved.
describe('session runtime migrate-forward', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0038_funny_calypso' })
  it('adds ownership to a populated pre-upgrade database without rebuilding history', () => {
    dbh.sqlite
      .prepare(
        "INSERT INTO agent (id, type, name, instructions, order_key, created_at, updated_at) VALUES ('agent', 'claude-code', 'Agent', 'Keep me', 'a0', 1, 1)"
      )
      .run()
    dbh.sqlite
      .prepare(
        "INSERT INTO agent_workspace (id, type, name, path, order_key, created_at, updated_at) VALUES ('work', 'user', 'Work', '/work', 'a0', 1, 1)"
      )
      .run()
    dbh.sqlite
      .prepare(
        "INSERT INTO agent_session (id, agent_id, name, workspace_id, order_key, last_activity_at, created_at, updated_at) VALUES ('session', 'agent', 'History', 'work', 'a0', 1, 1, 1)"
      )
      .run()
    dbh.sqlite
      .prepare(
        "INSERT INTO agent_session_message (id, session_id, role, data, status, created_at, updated_at) VALUES ('message', 'session', 'user', ?, 'success', 1, 1)"
      )
      .run(JSON.stringify({ parts: [{ type: 'text', text: 'Saved content' }] }))
    applyMigrations(dbh.db, resolveMigrationsPath())
    new AgentSessionRuntimeSeeder().run(dbh.db)
    expect(agentSessionService.getRuntimeType('session')).toBe('claude-code')
    expect(agentService.getAgent('agent')?.type).toBe('pi-durable')
    expect(dbh.sqlite.prepare('SELECT data FROM agent_session_message WHERE id = ?').get('message')).toEqual({
      data: JSON.stringify({ parts: [{ type: 'text', text: 'Saved content' }] })
    })
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    expect(dbh.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
  })
})
