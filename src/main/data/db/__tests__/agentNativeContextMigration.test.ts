import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { v7 as uuid } from 'uuid'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { AgentSessionMessageTreeSeeder } from '@data/db/seeding/seeders/AgentSessionMessageTreeSeeder'

function archive(dbh: ReturnType<typeof setupTestDatabase>) {
  const workspaceId = uuid()
  const sessionId = uuid()
  const messageId = uuid()
  dbh.sqlite
    .prepare(
      'INSERT INTO agent_workspace (id, name, path, type, order_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1)'
    )
    .run(workspaceId, 'Existing', '/existing', 'user', 'a0')
  dbh.sqlite
    .prepare(
      'INSERT INTO agent_session (id, workspace_id, name, order_key, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, 1)'
    )
    .run(sessionId, workspaceId, 'Existing', 'a0')
  dbh.sqlite
    .prepare(`INSERT INTO agent_session_message
    (id, session_id, role, data, status, runtime_resume_token, delivery_status, searchable_text, created_at, updated_at)
    VALUES (?, ?, 'user', ?, 'success', 'old-native-token', 'accepted', 'preserved searchable archive', 1, 1)`)
    .run(messageId, sessionId, JSON.stringify({ parts: [{ type: 'text', text: 'preserved searchable archive' }] }))
  const fileId = uuid()
  dbh.sqlite
    .prepare(
      "INSERT INTO file_entry (id, origin, name, external_path, created_at, updated_at) VALUES (?, 'external', ?, ?, 1, 1)"
    )
    .run(fileId, 'attachment', '/existing/attachment.txt')
  dbh.sqlite
    .prepare(
      "INSERT INTO agent_session_message_file_ref (id, file_entry_id, source_id, role, created_at, updated_at) VALUES (?, ?, ?, 'attachment', 1, 1)"
    )
    .run(uuid(), fileId, messageId)
  return { messageId }
}

function assertArchive(
  dbh: ReturnType<typeof setupTestDatabase>,
  messageId: string,
  before: unknown,
  attachment: unknown
) {
  const row = dbh.sqlite.prepare('SELECT * FROM agent_session_message WHERE id = ?').get(messageId) as Record<
    string,
    unknown
  >
  // 0037 moves the body into ordered part rows; every other column must survive unchanged.
  const { data: beforeData, ...beforeColumns } = before as Record<string, unknown>
  const { parts, ...metadata } = JSON.parse(beforeData as string) as { parts: unknown[] }
  expect(row).toMatchObject(beforeColumns)
  expect(JSON.parse(row.data as string)).toEqual(metadata)
  expect(
    (
      dbh.sqlite
        .prepare('SELECT payload FROM agent_session_message_part WHERE message_id = ? ORDER BY seq')
        .all(messageId) as Array<{ payload: string }>
    ).map((part) => JSON.parse(part.payload))
  ).toEqual(parts)
  expect(dbh.sqlite.prepare('SELECT * FROM agent_session_message_file_ref').get()).toEqual(attachment)
  expect(
    dbh.sqlite
      .prepare("SELECT count(*) AS n FROM agent_session_message_fts WHERE agent_session_message_fts MATCH 'searchable'")
      .get()
  ).toEqual({ n: 1 })
  expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
}

describe('native context migrate-forward', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0031_agent_native_contexts' })

  it('preserves an older populated archive without inventing native input bindings', () => {
    const { messageId } = archive(dbh)
    const before = dbh.sqlite.prepare('SELECT * FROM agent_session_message WHERE id = ?').get(messageId)
    const attachment = dbh.sqlite.prepare('SELECT * FROM agent_session_message_file_ref').get()
    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    new AgentSessionMessageTreeSeeder().run(dbh.db)
    assertArchive(dbh, messageId, before, attachment)
    expect(dbh.sqlite.prepare('SELECT parent_id FROM agent_session_message WHERE id = ?').get(messageId)).toEqual({
      parent_id: expect.any(String)
    })
    expect(
      dbh.sqlite
        .prepare('SELECT input_context_id, native_input_id FROM agent_session_message WHERE id = ?')
        .get(messageId)
    ).toEqual({ input_context_id: null, native_input_id: null })
    expect(dbh.sqlite.prepare('SELECT count(*) AS n FROM agent_session_context').get()).toEqual({ n: 0 })
    expect(
      (dbh.sqlite.pragma('table_info(agent_session_message)') as { name: string }[]).map((column) => column.name)
    ).not.toContain('submission')
  })
})

describe('agent backend recovery migrate-forward', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0047_agent_session_reply_and_recovery' })

  it('marks only previously bound Pi Durable backends and preserves a completed recovery on restart', () => {
    const insert = dbh.sqlite.prepare(
      'INSERT INTO agent_runtime_backend (id, locator, state, created_at, updated_at) VALUES (?, ?, ?, 1, 1)'
    )
    insert.run('bound', JSON.stringify({ version: 1, kind: 'pi-durable', fileName: 'existing' }), 'bound')
    insert.run('creating', JSON.stringify({ version: 1, kind: 'pi-durable', fileName: 'new' }), 'creating')
    insert.run('claude', JSON.stringify({ version: 1, kind: 'claude-code', configDir: 'config' }), 'bound')
    insert.run('pi', JSON.stringify({ version: 1, kind: 'pi' }), 'bound')

    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    expect(dbh.sqlite.prepare('SELECT id, needs_recovery_check FROM agent_runtime_backend ORDER BY id').all()).toEqual([
      { id: 'bound', needs_recovery_check: 1 },
      { id: 'claude', needs_recovery_check: 0 },
      { id: 'creating', needs_recovery_check: 0 },
      { id: 'pi', needs_recovery_check: 0 }
    ])

    dbh.sqlite.prepare("UPDATE agent_runtime_backend SET needs_recovery_check = 0 WHERE id = 'bound'").run()
    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    expect(dbh.sqlite.prepare('SELECT id FROM agent_runtime_backend WHERE needs_recovery_check = 1').all()).toEqual([])
  })
})
