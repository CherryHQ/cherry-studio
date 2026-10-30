import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { v7 as uuid } from 'uuid'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { fileEntryTable } from '@data/db/schemas/file'
import { agentSessionMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { AgentSessionMessageTreeSeeder } from '@data/db/seeding/seeders/AgentSessionMessageTreeSeeder'

// The additive migration must preserve a populated v2 archive, including pending delivery and FTS.
describe('native context migrate-forward', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0030_hard_dark_phoenix' })
  it('preserves existing messages and delivery state without inventing native admission', () => {
    const workspaceId = uuid()
    const sessionId = uuid()
    const messageId = uuid()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: workspaceId, name: 'Existing', path: '/existing', type: 'user', orderKey: 'a0' })
      .run()
    dbh.sqlite
      .prepare(
        'INSERT INTO agent_session (id, workspace_id, name, order_key, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(sessionId, workspaceId, 'Existing', 'a0', 1, 1, 1)
    dbh.sqlite
      .prepare(`INSERT INTO agent_session_message
        (id, session_id, role, status, runtime_resume_token, data, delivery_status, created_at, updated_at)
        VALUES (?, ?, 'user', 'success', 'old-native-token', ?, 'accepted', 1, 1)`)
      .run(messageId, sessionId, JSON.stringify({ parts: [{ type: 'text', text: 'preserved searchable archive' }] }))
    const fileId = uuid()
    dbh.db
      .insert(fileEntryTable)
      .values({ id: fileId, origin: 'external', name: 'attachment', externalPath: '/existing/attachment.txt' })
      .run()
    dbh.db
      .insert(agentSessionMessageFileRefTable)
      .values({ fileEntryId: fileId, sourceId: messageId, role: 'attachment' })
      .run()
    const attachment = dbh.db.select().from(agentSessionMessageFileRefTable).get()
    const before = dbh.sqlite.prepare('SELECT * FROM agent_session_message').get()
    const folder = resolve('migrations/sqlite-drizzle')
    applyMigrations(dbh.db, folder)
    applyMigrations(dbh.db, folder)
    expect(dbh.sqlite.prepare('SELECT * FROM agent_session_message').get()).toEqual({
      ...before!,
      submission: null,
      parent_id: null
    })
    expect(
      dbh.sqlite
        .prepare(
          "SELECT count(*) AS n FROM agent_session_message_fts WHERE agent_session_message_fts MATCH 'searchable'"
        )
        .get()
    ).toEqual({ n: 1 })
    expect(dbh.sqlite.prepare('SELECT count(*) AS n FROM agent_session_context').get()).toEqual({ n: 0 })
    expect(dbh.db.select().from(agentSessionMessageFileRefTable).get()).toEqual(attachment)
    new AgentSessionMessageTreeSeeder().run(dbh.db)
    expect(dbh.db.select().from(agentSessionTable).get()?.activeNodeId).toBe(messageId)
    expect(dbh.db.select().from(agentSessionMessageFileRefTable).get()).toEqual(attachment)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})
