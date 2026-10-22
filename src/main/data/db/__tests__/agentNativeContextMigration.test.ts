import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { v7 as uuid } from 'uuid'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { fileEntryTable } from '@data/db/schemas/file'
import { agentSessionMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { AgentSessionMessageTreeSeeder } from '@data/db/seeding/seeders/AgentSessionMessageTreeSeeder'

// The additive migration must preserve a populated v2 archive, including pending delivery and FTS.
describe('native context migrate-forward', () => {
  const dbh = setupTestDatabase()
  it('preserves existing messages and delivery state without inventing native admission', () => {
    const workspaceId = uuid()
    const sessionId = uuid()
    const messageId = uuid()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: workspaceId, name: 'Existing', path: '/existing', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db.insert(agentSessionTable).values({ id: sessionId, workspaceId, name: 'Existing', orderKey: 'a0' }).run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: messageId,
        sessionId,
        role: 'user',
        status: 'success',
        runtimeResumeToken: 'old-native-token',
        data: { parts: [{ type: 'text', text: 'preserved searchable archive' }] }
      })
      .run()
    dbh.db.update(agentSessionMessageTable).set({ deliveryStatus: 'accepted' }).run()
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
    const before = dbh.db.select().from(agentSessionMessageTable).get()!
    const folder = resolve('migrations/sqlite-drizzle')
    const journal = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string; when: number }>
    }
    const migration = journal.entries.find((item) => item.tag === '0028_absurd_maximus')!
    dbh.sqlite.exec(
      `DROP TABLE agent_session_context; DROP TABLE agent_runtime_backend;
       DROP INDEX agent_session_message_parent_idx; DROP INDEX agent_session_message_root_uniq;
       ALTER TABLE agent_session_message DROP COLUMN submission;
       ALTER TABLE agent_session_message DROP COLUMN parent_id;
       ALTER TABLE agent_session DROP COLUMN active_node_id;`
    )
    dbh.sqlite.prepare('DELETE FROM __drizzle_migrations WHERE created_at >= ?').run(migration.when)
    applyMigrations(dbh.db, folder)
    applyMigrations(dbh.db, folder)
    expect(dbh.db.select().from(agentSessionMessageTable).get()).toEqual({ ...before, submission: null })
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
