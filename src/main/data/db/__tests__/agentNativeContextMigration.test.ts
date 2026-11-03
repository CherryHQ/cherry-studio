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
    const migration = journal.entries.find((item) => item.tag === '0031_agent_native_contexts')!
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

describe('native context binding migrate-forward', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0032_context_binding_state' })

  it('preserves pending and confirmed identities without promoting unfinished creation', () => {
    dbh.sqlite
      .prepare(
        "INSERT INTO agent_workspace (id, name, path, type, order_key, created_at, updated_at) VALUES ('workspace', 'Existing', '/existing', 'user', 'a0', 1, 1)"
      )
      .run()
    dbh.sqlite
      .prepare(
        "INSERT INTO agent_session (id, workspace_id, name, order_key, last_activity_at, created_at, updated_at) VALUES ('session', 'workspace', 'Existing', 'a0', 1, 1, 1)"
      )
      .run()
    dbh.sqlite
      .prepare('INSERT INTO agent_runtime_backend (id, locator, state, created_at, updated_at) VALUES (?, ?, ?, 1, 1)')
      .run('backend', JSON.stringify({ version: 1, kind: 'pi' }), 'bound')
    const insert = dbh.sqlite.prepare(
      'INSERT INTO agent_session_context (id, session_id, backend_id, intended_thread_id, native_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1)'
    )
    insert.run('reserved', 'session', 'backend', 'reserved-native', null)
    insert.run('confirmed', 'session', 'backend', 'confirmed-native', 'confirmed-native')
    insert.run('discovered', 'session', 'backend', null, 'discovered-native')
    insert.run('unassigned', 'session', 'backend', null, null)

    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    expect(
      dbh.sqlite.prepare('SELECT id, native_thread_id, binding_state FROM agent_session_context ORDER BY id').all()
    ).toEqual([
      { id: 'confirmed', native_thread_id: 'confirmed-native', binding_state: 'bound' },
      { id: 'discovered', native_thread_id: 'discovered-native', binding_state: 'bound' },
      { id: 'reserved', native_thread_id: 'reserved-native', binding_state: 'pending' },
      { id: 'unassigned', native_thread_id: null, binding_state: 'pending' }
    ])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    expect(
      dbh.sqlite
        .prepare("SELECT name FROM pragma_table_info('agent_session_context') WHERE name = 'intended_thread_id'")
        .all()
    ).toEqual([])
  })
})
