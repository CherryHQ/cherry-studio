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
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'

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
    agentSessionMessageService.saveMessage({
      sessionId,
      runtimeResumeToken: 'old-native-token',
      message: {
        id: messageId,
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'preserved searchable archive' }] }
      }
    })
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
      'DROP TABLE agent_session_context; DROP TABLE agent_runtime_backend; ALTER TABLE agent_session_message DROP COLUMN submission'
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
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})
