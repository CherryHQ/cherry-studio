import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { v7 as uuid } from 'uuid'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'

// Triggers shipped before 0037: both rebuild `searchable_text` from `data.parts`.
const SHIPPED_TRIGGERS = [
  'DROP TRIGGER IF EXISTS agent_session_message_ai',
  'DROP TRIGGER IF EXISTS agent_session_message_au',
  `CREATE TRIGGER agent_session_message_ai AFTER INSERT ON agent_session_message BEGIN
    UPDATE agent_session_message SET
      fts_rowid = (SELECT COALESCE(MAX(fts_rowid), 0) + 1 FROM agent_session_message),
      searchable_text = COALESCE((
        SELECT group_concat(json_extract(value, '$.text'), char(10))
        FROM json_each(json_extract(NEW.data, '$.parts'))
        WHERE json_extract(value, '$.type') = 'text'
      ), '')
    WHERE id = NEW.id;
    INSERT INTO agent_session_message_fts(rowid, searchable_text)
    SELECT fts_rowid, searchable_text FROM agent_session_message WHERE id = NEW.id;
  END`,
  `CREATE TRIGGER agent_session_message_au AFTER UPDATE OF data ON agent_session_message WHEN OLD.data IS NOT NEW.data BEGIN
    INSERT INTO agent_session_message_fts(agent_session_message_fts, rowid, searchable_text)
    VALUES ('delete', OLD.fts_rowid, OLD.searchable_text);
    UPDATE agent_session_message SET searchable_text = COALESCE((
      SELECT group_concat(json_extract(value, '$.text'), char(10))
      FROM json_each(json_extract(NEW.data, '$.parts'))
      WHERE json_extract(value, '$.type') = 'text'
    ), '') WHERE id = NEW.id;
    INSERT INTO agent_session_message_fts(rowid, searchable_text)
    SELECT fts_rowid, searchable_text FROM agent_session_message WHERE id = NEW.id;
  END`
]

describe('agent session message part migration (0037)', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0037_agent_session_message_part' })

  const ftsIds = (term: string) =>
    (
      dbh.sqlite
        .prepare(
          `SELECT m.id FROM agent_session_message m
           JOIN agent_session_message_fts fts ON m.fts_rowid = fts.rowid
           WHERE agent_session_message_fts MATCH ?`
        )
        .all(term) as Array<{ id: string }>
    ).map((row) => row.id)

  it('moves ordered bodies into part rows while keeping metadata, search and tool outputs', () => {
    for (const statement of SHIPPED_TRIGGERS) dbh.sqlite.exec(statement)
    const workspaceId = uuid()
    const sessionId = uuid()
    const userId = uuid()
    const assistantId = uuid()
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

    const userParts = [{ type: 'text', text: 'alphaneedle question' }]
    const deferred = {
      $deferredToolResult: { topicId: `agent-session:${sessionId}`, messageId: assistantId, toolCallId: 'call-1' }
    }
    const assistantParts = [
      { type: 'reasoning', text: 'hiddenthought' },
      {
        type: 'dynamic-tool',
        toolName: 'bash',
        toolCallId: 'call-1',
        state: 'output-available',
        input: {},
        output: deferred
      },
      { type: 'text', text: 'first answer' },
      { type: 'text', text: 'second answer' }
    ]
    const assistantMetadata = {
      nativeSessionId: 'native-thread',
      runtimeAnchor: { checkpoint: { runtime: 'pi', boundary: 3 } },
      turnOptions: { fastMode: true }
    }
    const insertMessage = dbh.sqlite.prepare(
      `INSERT INTO agent_session_message (id, session_id, role, data, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'success', ?, ?)`
    )
    insertMessage.run(userId, sessionId, 'user', JSON.stringify({ parts: userParts }), 10, 11)
    insertMessage.run(
      assistantId,
      sessionId,
      'assistant',
      JSON.stringify({ parts: assistantParts, ...assistantMetadata }),
      20,
      21
    )
    dbh.sqlite
      .prepare(
        `INSERT INTO agent_session_tool_output (message_id, tool_call_id, session_id, output, created_at, updated_at)
         VALUES (?, 'call-1', ?, ?, 1, 1)`
      )
      .run(assistantId, sessionId, JSON.stringify({ stdout: 'full tool output' }))
    expect(ftsIds('alphaneedle')).toEqual([userId])

    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))

    const storedParts = (messageId: string) =>
      (
        dbh.sqlite
          .prepare(
            'SELECT seq, type, payload, session_id FROM agent_session_message_part WHERE message_id = ? ORDER BY seq'
          )
          .all(messageId) as Array<{ seq: number; type: string; payload: string; session_id: string }>
      ).map((row) => ({ ...row, payload: JSON.parse(row.payload) }))
    expect(storedParts(assistantId)).toEqual(
      assistantParts.map((part, seq) => ({ seq, type: part.type, payload: part, session_id: sessionId }))
    )
    const containers = dbh.sqlite
      .prepare('SELECT id, data, searchable_text, updated_at FROM agent_session_message ORDER BY created_at')
      .all() as Array<{ id: string; data: string; searchable_text: string; updated_at: number }>
    expect(containers.map((row) => ({ ...row, data: JSON.parse(row.data) }))).toEqual([
      { id: userId, data: {}, searchable_text: 'alphaneedle question', updated_at: 11 },
      { id: assistantId, data: assistantMetadata, searchable_text: 'first answer\nsecond answer', updated_at: 21 }
    ])
    expect(ftsIds('alphaneedle')).toEqual([userId])
    expect(ftsIds('second answer')).toEqual([assistantId])
    expect(ftsIds('hiddenthought')).toEqual([])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])

    const assembled = agentSessionMessageService.getSessionMessage(sessionId, assistantId).data.parts
    expect(assembled?.map((part) => part.type)).toEqual(assistantParts.map((part) => part.type))
    expect(assembled?.[1]).toMatchObject({ toolCallId: 'call-1', output: { stdout: 'full tool output' } })

    agentSessionMessageService.updateSessionMessage(sessionId, userId, {
      data: { parts: [{ type: 'text', text: 'betaneedle rewrite' }] }
    })
    expect(ftsIds('alphaneedle')).toEqual([])
    expect(ftsIds('betaneedle')).toEqual([userId])
  })
})
