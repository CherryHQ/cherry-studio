import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { v7 as uuid } from 'uuid'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'

// Triggers shipped before 0042: both rebuild `searchable_text` from `data.parts`.
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

describe('agent session message part migration', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0042_agent_history_artifacts_and_mcp' })

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
    const assistantParts = [
      { type: 'reasoning', text: 'hiddenthought' },
      {
        type: 'dynamic-tool',
        toolName: 'bash',
        toolCallId: 'call-1',
        state: 'output-available',
        input: {},
        output: { stdout: 'full tool output' }
      },
      { type: 'text', text: 'first answer' },
      { type: 'text', text: 'second answer' }
    ]
    const assistantMetadata = {
      nativeSessionId: 'native-thread',
      runtimeAnchor: { checkpoint: { runtime: 'pi', boundary: 3 } },
      turnOptions: { fastMode: true }
    }
    const rootId = uuid()
    dbh.sqlite
      .prepare(
        "INSERT INTO agent_session_message (id, session_id, role, data, status, created_at, updated_at) VALUES (?, ?, 'root', '{}', 'success', 1, 1)"
      )
      .run(rootId, sessionId)
    const insertMessage = dbh.sqlite.prepare(
      `INSERT INTO agent_session_message (id, session_id, role, data, status, created_at, updated_at, parent_id)
       VALUES (?, ?, ?, ?, 'success', ?, ?, ?)`
    )
    insertMessage.run(userId, sessionId, 'user', JSON.stringify({ parts: userParts }), 10, 11, rootId)
    insertMessage.run(
      assistantId,
      sessionId,
      'assistant',
      JSON.stringify({ parts: assistantParts, ...assistantMetadata }),
      20,
      21,
      rootId
    )
    expect(ftsIds('alphaneedle')).toEqual([userId])

    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))

    const storedParts = (messageId: string) =>
      (
        dbh.sqlite
          .prepare(
            'SELECT seq, pos, type, payload, session_id FROM agent_session_message_part WHERE message_id = ? ORDER BY seq'
          )
          .all(messageId) as Array<{
          seq: number
          pos: number | null
          type: string
          payload: string
          session_id: string
        }>
      ).map((row) => ({ ...row, payload: JSON.parse(row.payload) }))
    expect(storedParts(assistantId)).toEqual(
      assistantParts.map((part, seq) => ({ seq, pos: seq + 2, type: part.type, payload: part, session_id: sessionId }))
    )
    expect(storedParts(userId)).toEqual([
      { seq: 0, pos: null, type: 'text', payload: userParts[0], session_id: sessionId }
    ])
    expect(dbh.sqlite.prepare('SELECT pos FROM agent_session_message WHERE id = ?').get(userId)).toEqual({ pos: 1 })
    expect(dbh.sqlite.prepare('SELECT last_pos FROM agent_session WHERE id = ?').get(sessionId)).toEqual({
      last_pos: 5
    })
    const containers = dbh.sqlite
      .prepare(
        "SELECT id, data, searchable_text, updated_at FROM agent_session_message WHERE role != 'root' ORDER BY created_at"
      )
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

describe('legacy Agent tool result migration', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0042_agent_history_artifacts_and_mcp' })

  it('archives large inline results while preserving full reads and special display data', () => {
    dbh.sqlite.exec(`
      INSERT INTO agent_workspace (id, name, path, type, order_key, created_at, updated_at)
      VALUES ('workspace', 'Existing', '/existing', 'user', 'a0', 1, 1);
      INSERT INTO agent_session (id, workspace_id, name, order_key, last_activity_at, created_at, updated_at)
      VALUES ('session', 'workspace', 'Existing', 'a0', 1, 1, 1);
      INSERT INTO agent_session_message (id, session_id, role, data, status, created_at, updated_at)
      VALUES ('root', 'session', 'root', '{}', 'success', 1, 1);
    `)
    const result = (toolCallId: string, output: unknown) => ({
      type: 'dynamic-tool',
      toolName: 'example',
      toolCallId,
      state: 'output-available',
      input: {},
      output
    })
    const largeText = '字'.repeat(16 * 1024)
    const imageOutput = { content: [{ type: 'image', data: 'A'.repeat(40 * 1024), mimeType: 'image/png' }] }
    const providerMetadata = { vendor: { operationId: 'abc' } }
    const originalParts = [
      { ...result('large-image', imageOutput), resultProviderMetadata: providerMetadata },
      { type: 'tool-example', toolCallId: 'large-error', state: 'output-error', input: {}, errorText: largeText },
      result('large-text', largeText),
      result('small', 'short'),
      result('citation', [{ id: 1, title: 'Source', url: 'https://example.com', content: largeText }]),
      result('app', { content: imageOutput.content, metadata: { type: 'mcp', app: { resourceUri: 'ui://example' } } }),
      result('repeated', largeText),
      result('repeated', 'replacement')
    ]
    dbh.sqlite
      .prepare(`
        INSERT INTO agent_session_message (id, session_id, parent_id, role, data, status, created_at, updated_at)
        VALUES ('reply', 'session', 'root', 'assistant', ?, 'success', 2, 3)
      `)
      .run(JSON.stringify({ parts: originalParts }))

    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))

    const parts = agentSessionMessageService.getStoredMessageParts('session', 'reply')
    const marker = (partId: string, toolCallId: string) => ({
      $deferredToolResult: { topicId: 'agent-session:session', messageId: 'reply', toolCallId, partId }
    })
    expect(parts.map(({ pos }) => pos)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(parts[0].payload).toEqual(
      result('large-image', { ...marker(parts[0].partId, 'large-image'), archivedProviderMetadata: true })
    )
    expect(parts[1].payload).toEqual({
      ...originalParts[1],
      errorText: largeText.slice(0, 511) + '…',
      resultProviderMetadata: { cherry: { deferredToolOutput: marker(parts[1].partId, 'large-error') } }
    })
    expect(parts[2].payload).toEqual(result('large-text', marker(parts[2].partId, 'large-text')))
    expect(parts.slice(3).map(({ payload }) => payload)).toEqual(originalParts.slice(3))
    expect(agentSessionMessageService.getSessionMessage('session', 'reply').data.parts).toEqual(originalParts)
    expect(agentSessionMessageService.getSessionToolOutput('session', 'reply', 'large-image', parts[0].partId)).toEqual(
      {
        found: true,
        output: imageOutput
      }
    )
    const range = agentSessionMessageService.getSessionToolOutputRange(
      'session',
      'reply',
      'large-text',
      0,
      parts[2].partId
    )
    expect(range?.bytes.toString()).toBe(JSON.stringify(largeText))
    expect(range?.hasMore).toBe(false)
    expect(
      dbh.sqlite.prepare('SELECT tool_call_id FROM agent_session_tool_output ORDER BY tool_call_id').pluck().all()
    ).toEqual(['large-error', 'large-image', 'large-text'])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})

describe('agent session timeline position migration', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0042_agent_history_artifacts_and_mcp' })

  it('assigns stable part IDs and positions in ancestry order', () => {
    const workspaceId = uuid()
    const sessionId = uuid()
    const rootId = uuid()
    const inputId = uuid()
    const runId = uuid()
    const siblingId = uuid()
    dbh.sqlite
      .prepare(
        "INSERT INTO agent_workspace (id, name, path, type, order_key, created_at, updated_at) VALUES (?, 'Saved', '/saved', 'user', 'a0', 1, 1)"
      )
      .run(workspaceId)
    dbh.sqlite
      .prepare(
        "INSERT INTO agent_session (id, workspace_id, name, order_key, last_activity_at, active_node_id, created_at, updated_at) VALUES (?, ?, 'Saved', 'a0', 1, ?, 1, 1)"
      )
      .run(sessionId, workspaceId, runId)
    const insertMessage = dbh.sqlite.prepare(
      "INSERT INTO agent_session_message (id, session_id, role, parent_id, data, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'success', ?, 1)"
    )
    insertMessage.run(rootId, sessionId, 'root', null, '{}', 90)
    insertMessage.run(inputId, sessionId, 'user', rootId, '{}', 60)
    insertMessage.run(
      runId,
      sessionId,
      'assistant',
      inputId,
      '{"parts":[{"type":"text","text":"First"},{"type":"text","text":"Second"}]}',
      20
    )
    insertMessage.run(siblingId, sessionId, 'assistant', inputId, '{"parts":[{"type":"text","text":"Sibling"}]}', 30)

    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))

    expect(dbh.sqlite.prepare('SELECT pos FROM agent_session_message WHERE id = ?').get(inputId)).toEqual({ pos: 1 })
    const readPositions = dbh.sqlite.prepare(
      "SELECT id, pos, json_extract(payload, '$.text') AS text FROM agent_session_message_part ORDER BY pos"
    )
    const positions = readPositions.all()
    expect(positions).toEqual([
      { id: expect.any(String), pos: 2, text: 'First' },
      { id: expect.any(String), pos: 3, text: 'Second' },
      { id: expect.any(String), pos: 4, text: 'Sibling' }
    ])
    expect(
      dbh.sqlite.prepare('SELECT last_pos, active_node_id FROM agent_session WHERE id = ?').get(sessionId)
    ).toEqual({ last_pos: 4, active_node_id: runId })
    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    expect(readPositions.all()).toEqual(positions)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})
