import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { v7 as uuid } from 'uuid'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'

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
  return { sessionId, messageId }
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
  expect(row).toMatchObject(before as Record<string, unknown>)
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
    assertArchive(dbh, messageId, before, attachment)
    expect(
      dbh.sqlite
        .prepare('SELECT input_context_id, native_input_id FROM agent_session_message WHERE id = ?')
        .get(messageId)
    ).toEqual({ input_context_id: null, native_input_id: null })
    expect(dbh.sqlite.prepare('SELECT count(*) AS n FROM agent_session_context').get()).toEqual({ n: 0 })
  })
})

describe('native input binding migrate-forward', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0032_agent_input_bindings' })

  it('preserves the captured target and native identity, including failed inputs, while dropping the receipt mirror', () => {
    const { sessionId, messageId } = archive(dbh)
    const backendId = uuid()
    const contextId = uuid()
    dbh.sqlite
      .prepare(
        "INSERT INTO agent_runtime_backend (id, locator, state, created_at, updated_at) VALUES (?, ?, 'bound', 1, 1)"
      )
      .run(backendId, JSON.stringify({ version: 1, kind: 'pi' }))
    dbh.sqlite
      .prepare(`INSERT INTO agent_session_context (id, session_id, backend_id, native_thread_id, binding_state, created_at, updated_at)
      VALUES (?, ?, ?, 'native-session', 'bound', 1, 1)`)
      .run(contextId, sessionId, backendId)
    dbh.sqlite.prepare('UPDATE agent_session_message SET submission = ? WHERE id = ?').run(
      JSON.stringify({
        contextId,
        nativeInputId: 'native-input',
        contentHash: 'old-hash',
        whenBusy: 'reject',
        facts: ['accepted'],
        outcome: 'failed'
      }),
      messageId
    )
    const uncertainId = uuid()
    dbh.sqlite
      .prepare(`INSERT INTO agent_session_message (id, session_id, role, data, status, submission, created_at, updated_at)
      VALUES (?, ?, 'user', ?, 'success', ?, 2, 2)`)
      .run(
        uncertainId,
        sessionId,
        JSON.stringify({ parts: [{ type: 'text', text: 'uncertain' }] }),
        JSON.stringify({ contextId, contentHash: 'another-hash', whenBusy: 'steer', facts: [] })
      )
    const before = dbh.sqlite.prepare('SELECT * FROM agent_session_message WHERE id = ?').get(messageId) as Record<
      string,
      unknown
    >
    delete before.submission
    const attachment = dbh.sqlite.prepare('SELECT * FROM agent_session_message_file_ref').get()
    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    assertArchive(dbh, messageId, before, attachment)
    expect(
      dbh.sqlite
        .prepare('SELECT input_context_id, native_input_id FROM agent_session_message WHERE id = ?')
        .get(messageId)
    ).toEqual({ input_context_id: contextId, native_input_id: 'native-input' })
    expect(
      dbh.sqlite
        .prepare('SELECT input_context_id, native_input_id FROM agent_session_message WHERE id = ?')
        .get(uncertainId)
    ).toEqual({ input_context_id: contextId, native_input_id: null })
    expect(
      (dbh.sqlite.pragma('table_info(agent_session_message)') as { name: string }[]).map((column) => column.name)
    ).not.toContain('submission')
  })
})
