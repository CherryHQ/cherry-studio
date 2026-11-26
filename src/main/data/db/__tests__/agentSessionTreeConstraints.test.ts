import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { agentSessionTable as sessions } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable as messages } from '@data/db/schemas/agentSessionMessage'
import { agentSessionMessageService as service } from '@data/services/AgentSessionMessageService'
import { readAgentSessionPath } from '@data/services/agentSessionMessageTree'

function seedSessions(dbh: ReturnType<typeof setupTestDatabase>) {
  dbh.sqlite.exec(`
    INSERT INTO agent_workspace (id, name, path, type, order_key, created_at, updated_at)
    VALUES ('work', 'Work', '/work', 'user', 'a0', 10, 20);
    INSERT INTO agent_session (id, name, workspace_id, order_key, created_at, updated_at, last_activity_at)
    VALUES ('flat', 'flat', 'work', 'flat', 10, 20, 10),
           ('branched', 'branched', 'work', 'branched', 10, 20, 10);
  `)
}

describe('Session tree storage constraints', () => {
  const dbh = setupTestDatabase()

  it('rejects dangling and cross-session parents, root mismatches and direct parent deletion', () => {
    seedSessions(dbh)
    const root = service.captureHead('flat')
    const other = service.captureHead('branched')
    const insert = (role: string, parentId: string | null) =>
      dbh.db.insert(messages).values({ sessionId: 'flat', role, parentId, status: 'success', data: {} }).run()
    expect(() => insert('user', null)).toThrow()
    expect(() => insert('user', 'missing')).toThrow()
    expect(() => insert('user', other)).toThrow()
    expect(() => insert('root', root)).toThrow()
    const first = service.saveMessage({ sessionId: 'flat', message: { role: 'user', data: {} } })
    const second = service.saveMessage({ sessionId: 'flat', message: { role: 'assistant', data: {} } })
    expect(() => dbh.db.update(messages).set({ parentId: other }).where(eq(messages.id, first.id)).run()).toThrow()
    expect(() => dbh.db.delete(messages).where(eq(messages.id, first.id)).run()).toThrow()
    service.deleteSessionMessage('flat', first.id)
    expect(readAgentSessionPath(dbh.db, 'flat').map((row) => row.id)).toEqual([second.id])
    expect(dbh.db.select().from(messages).where(eq(messages.id, second.id)).get()?.parentId).toBe(root)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('deletes a session with a deep chain without recursive self-cascade or touching other sessions', () => {
    seedSessions(dbh)
    let parentId = service.captureHead('flat')
    const otherRoot = service.captureHead('branched')
    dbh.db.transaction((tx) => {
      for (let i = 0; i < 2000; i++) {
        const id = `message-${i}`
        tx.insert(messages).values({ id, sessionId: 'flat', parentId, role: 'user', status: 'success', data: {} }).run()
        parentId = id
      }
    })
    dbh.db.delete(sessions).where(eq(sessions.id, 'flat')).run()
    expect(dbh.db.select({ id: messages.id }).from(messages).all()).toEqual([{ id: otherRoot }])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})

describe('Session tree populated upgrade', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0039_agent_session_tree_backfill' })

  it('preserves all 10,001 flat messages and their order across upgrade', () => {
    seedSessions(dbh)
    const insert = dbh.sqlite.prepare(
      "INSERT INTO agent_session_message (id, session_id, role, data, status, created_at, updated_at) VALUES (?, 'flat', 'user', ?, 'success', ?, ?)"
    )
    dbh.sqlite.transaction(() => {
      for (let i = 0; i < 10001; i++)
        insert.run(
          `archive-${i}`,
          JSON.stringify({ parts: [{ type: 'text', text: `content-${i}` }] }),
          i + 100,
          i + 200
        )
    })()
    applyMigrations(dbh.db, resolveMigrationsPath())
    const path = readAgentSessionPath(dbh.db, 'flat')
    expect(path).toHaveLength(10001)
    for (let i = 0; i < path.length; i++)
      expect(path[i]).toMatchObject({
        id: `archive-${i}`,
        data: { parts: [{ type: 'text', text: `content-${i}` }] },
        createdAt: i + 100,
        updatedAt: i + 200,
        pos: i + 1
      })
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    dbh.sqlite.exec(
      "INSERT INTO agent_session_message_fts(agent_session_message_fts, rank) VALUES ('integrity-check', 1)"
    )
  })
})

describe('Session tree populated branch upgrade', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0039_agent_session_tree_backfill' })

  it('backfills flat history while preserving message facts, existing branches, selection and FTS', () => {
    seedSessions(dbh)
    const insert = dbh.sqlite.prepare(`
      INSERT INTO agent_session_message
        (id, session_id, role, parent_id, data, status, runtime_resume_token, created_at, updated_at, searchable_text)
      VALUES (?, ?, ?, ?, ?, 'success', ?, 100, 200, ?)
    `)
    for (const id of ['b', 'a']) {
      insert.run(
        id,
        'flat',
        'user',
        null,
        JSON.stringify({ parts: [{ type: 'text', text: `searchable ${id}` }] }),
        'native',
        `searchable ${id}`
      )
    }
    insert.run('root', 'branched', 'root', null, '{"parts":[]}', null, '')
    insert.run('first', 'branched', 'user', 'root', '{"parts":[]}', null, '')
    insert.run('second', 'branched', 'user', 'root', '{"parts":[]}', null, '')
    dbh.sqlite.prepare("UPDATE agent_session SET active_node_id = 'first' WHERE id = 'branched'").run()
    const before = dbh.sqlite
      .prepare<[], { id: string; session_id: string }>('SELECT * FROM agent_session_message ORDER BY id')
      .all()
    const sessionBefore = dbh.sqlite
      .prepare<[], Record<string, unknown>>("SELECT * FROM agent_session WHERE id = 'branched'")
      .get()
    applyMigrations(dbh.db, resolveMigrationsPath())
    expect(readAgentSessionPath(dbh.db, 'flat').map((row) => row.id)).toEqual(['a', 'b'])
    for (const row of before) {
      expect(dbh.sqlite.prepare('SELECT * FROM agent_session_message WHERE id = ?').get(row.id)).toMatchObject(
        row.session_id === 'flat' ? { ...row, data: '{}', parent_id: expect.any(String) } : { ...row, data: '{}' }
      )
    }
    expect(dbh.sqlite.prepare("SELECT * FROM agent_session WHERE id = 'branched'").get()).toEqual({
      ...sessionBefore,
      last_pos: 2
    })
    expect(dbh.db.select().from(sessions).where(eq(sessions.id, 'flat')).get()).toMatchObject({
      createdAt: 10,
      updatedAt: 20,
      activeNodeId: 'b'
    })
    expect(
      dbh.sqlite
        .prepare(
          "SELECT count(*) AS count FROM agent_session_message_fts WHERE agent_session_message_fts MATCH 'searchable'"
        )
        .get()
    ).toEqual({ count: 2 })
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    expect(dbh.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
    applyMigrations(dbh.db, resolveMigrationsPath())
    expect(readAgentSessionPath(dbh.db, 'flat').map((row) => row.id)).toEqual(['a', 'b'])
    dbh.sqlite.exec(
      "INSERT INTO agent_session_message_fts(agent_session_message_fts, rank) VALUES ('integrity-check', 1)"
    )
  })
})

describe('Session tree upgrade from v2.2.2 after a root was selected', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0038_clammy_jigsaw' })

  it('restores flat history underneath its already selected root', () => {
    seedSessions(dbh)
    dbh.sqlite.exec(`
      INSERT INTO agent_session_message (id, session_id, role, parent_id, data, status, created_at, updated_at)
      VALUES ('flat-root', 'flat', 'root', NULL, '{"parts":[]}', 'success', 300, 300),
             ('first', 'flat', 'user', NULL, '{"parts":[{"type":"text","text":"original input"}]}', 'success', 100, 100),
             ('reply', 'flat', 'assistant', NULL, '{"parts":[{"type":"text","text":"original reply"}]}', 'success', 200, 200);
      UPDATE agent_session SET active_node_id = 'flat-root' WHERE id = 'flat';
    `)

    applyMigrations(dbh.db, resolveMigrationsPath())

    expect(readAgentSessionPath(dbh.db, 'flat')).toMatchObject([
      { id: 'first', parentId: 'flat-root', data: { parts: [{ type: 'text', text: 'original input' }] } },
      { id: 'reply', parentId: 'first', data: { parts: [{ type: 'text', text: 'original reply' }] } }
    ])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})

describe('Session tree upgrade from v2.2.2 with mixed history', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0038_clammy_jigsaw' })

  it('recovers a detached subtree without changing existing branches or the selected head', () => {
    seedSessions(dbh)
    dbh.sqlite.exec(`
      INSERT INTO agent_session_message (id, session_id, role, parent_id, data, status, created_at, updated_at)
      VALUES ('root', 'branched', 'root', NULL, '{"parts":[]}', 'success', 100, 100),
             ('selected', 'branched', 'user', 'root', '{"parts":[]}', 'success', 200, 200),
             ('sibling', 'branched', 'user', 'root', '{"parts":[]}', 'success', 300, 300),
             ('detached', 'branched', 'user', NULL, '{"parts":[]}', 'success', 400, 400),
             ('child', 'branched', 'assistant', 'detached', '{"parts":[]}', 'success', 500, 500);
      UPDATE agent_session SET active_node_id = 'selected' WHERE id = 'branched';
    `)

    applyMigrations(dbh.db, resolveMigrationsPath())
    applyMigrations(dbh.db, resolveMigrationsPath())

    expect(readAgentSessionPath(dbh.db, 'branched')).toMatchObject([{ id: 'selected', parentId: 'root' }])
    expect(readAgentSessionPath(dbh.db, 'branched', 'sibling')).toMatchObject([{ id: 'sibling', parentId: 'root' }])
    expect(readAgentSessionPath(dbh.db, 'branched', 'child')).toMatchObject([
      { id: 'detached', parentId: 'root' },
      { id: 'child', parentId: 'detached' }
    ])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})

describe('Session tree upgrade after continuing a legacy conversation', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0038_clammy_jigsaw' })

  it('includes the old question and answer in the default and alternate branch history', () => {
    seedSessions(dbh)
    dbh.sqlite.exec(`
      INSERT INTO agent_session_message (id, session_id, role, parent_id, data, status, created_at, updated_at)
      VALUES ('old-question', 'flat', 'user', NULL, '{"parts":[{"type":"text","text":"first question"}]}', 'success', 100, 100),
             ('old-answer', 'flat', 'assistant', NULL, '{"parts":[{"type":"text","text":"first answer"}]}', 'success', 200, 200),
             ('root', 'flat', 'root', NULL, '{"parts":[]}', 'success', 300, 300),
             ('new-question', 'flat', 'user', 'root', '{"parts":[]}', 'success', 400, 400),
             ('new-answer', 'flat', 'assistant', 'new-question', '{"parts":[]}', 'success', 500, 500),
             ('alternate', 'flat', 'user', 'root', '{"parts":[]}', 'success', 600, 600);
      UPDATE agent_session SET active_node_id = 'new-answer' WHERE id = 'flat';
      UPDATE agent_session_message SET searchable_text = 'first answer' WHERE id = 'old-answer';
    `)

    applyMigrations(dbh.db, resolveMigrationsPath())

    const first = service.listSessionMessages('flat', { limit: 2 })
    expect(first.items.map((row) => row.id)).toEqual(['new-answer', 'new-question'])
    expect(first.nextCursor).toBeTruthy()
    const second = service.listSessionMessages('flat', { limit: 2, cursor: first.nextCursor })
    expect(second.items.map((row) => [row.id, row.data.parts])).toEqual([
      ['old-answer', [{ type: 'text', text: 'first answer' }]],
      ['old-question', [{ type: 'text', text: 'first question' }]]
    ])
    expect(second.nextCursor).toBeUndefined()
    expect(readAgentSessionPath(dbh.db, 'flat', 'alternate').map((row) => row.id)).toEqual([
      'old-question',
      'old-answer',
      'alternate'
    ])
    expect(
      dbh.sqlite
        .prepare(`SELECT m.id FROM agent_session_message_fts
        JOIN agent_session_message m ON m.fts_rowid = agent_session_message_fts.rowid
        WHERE agent_session_message_fts MATCH 'first answer'`)
        .pluck()
        .all()
    ).toEqual(['old-answer'])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})

describe('Session tree upgrade with invalid parents', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0039_agent_session_tree_backfill' })

  it('reattaches missing and foreign parent subtrees without changing another session or aborting migration', () => {
    seedSessions(dbh)
    dbh.sqlite.exec(`
      INSERT INTO agent_session (id, name, workspace_id, order_key, created_at, updated_at, last_activity_at)
      VALUES ('rootless', 'rootless', 'work', 'rootless', 100, 100, 100);
      INSERT INTO agent_session_message (id, session_id, role, parent_id, data, status, created_at, updated_at)
      VALUES ('orphan', 'rootless', 'user', 'missing', '{"parts":[]}', 'success', 200, 200),
             ('local-root', 'flat', 'root', 'missing', '{"parts":[]}', 'success', 100, 100),
             ('missing-parent', 'flat', 'user', 'missing', '{"parts":[]}', 'success', 300, 300),
             ('missing-parent-reply', 'flat', 'assistant', 'missing-parent', '{"parts":[]}', 'success', 400, 400),
             ('cross-session', 'flat', 'user', 'other-root', '{"parts":[]}', 'success', 500, 500),
             ('cross-session-reply', 'flat', 'assistant', 'cross-session', '{"parts":[]}', 'success', 600, 600),
             ('other-root', 'branched', 'root', NULL, '{"parts":[]}', 'success', 100, 100),
             ('other-branch', 'branched', 'user', 'other-root', '{"parts":[]}', 'success', 200, 200);
      UPDATE agent_session SET active_node_id = 'missing-parent-reply' WHERE id = 'flat';
      UPDATE agent_session SET active_node_id = 'other-branch' WHERE id = 'branched';
    `)

    applyMigrations(dbh.db, resolveMigrationsPath())

    expect(readAgentSessionPath(dbh.db, 'flat')).toMatchObject([
      { id: 'missing-parent', parentId: 'local-root' },
      { id: 'missing-parent-reply', parentId: 'missing-parent' }
    ])
    expect(readAgentSessionPath(dbh.db, 'flat', 'cross-session-reply')).toMatchObject([
      { id: 'cross-session', parentId: 'local-root' },
      { id: 'cross-session-reply', parentId: 'cross-session' }
    ])
    expect(readAgentSessionPath(dbh.db, 'branched')).toMatchObject([{ id: 'other-branch', parentId: 'other-root' }])
    const rootlessRoot = dbh.sqlite
      .prepare("SELECT id FROM agent_session_message WHERE session_id = 'rootless' AND role = 'root'")
      .pluck()
      .get()
    expect(rootlessRoot).toEqual(expect.any(String))
    expect(readAgentSessionPath(dbh.db, 'rootless')).toMatchObject([{ id: 'orphan', parentId: rootlessRoot }])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    dbh.sqlite.exec(
      "INSERT INTO agent_session_message_fts(agent_session_message_fts, rank) VALUES ('integrity-check', 1)"
    )
  })
})

describe('Session head upgrade from v2.2.3', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0042_agent_history_artifacts_and_mcp' })

  it('selects a reachable local leaf for null, missing and cross-session selections', () => {
    seedSessions(dbh)
    dbh.sqlite.exec(`
      INSERT INTO agent_session (id, name, workspace_id, order_key, created_at, updated_at, last_activity_at)
      VALUES ('missing-head', 'missing-head', 'work', 'missing', 1, 1, 1),
             ('valid-head', 'valid-head', 'work', 'valid', 1, 1, 1);
      INSERT INTO agent_session_message (id, session_id, role, parent_id, data, status, created_at, updated_at)
      SELECT id || '-root', id, 'root', NULL, '{"parts":[]}', 'success', 100, 100 FROM agent_session;
      INSERT INTO agent_session_message (id, session_id, role, parent_id, data, status, created_at, updated_at)
      SELECT id || '-first', id, 'user', id || '-root', '{"parts":[]}', 'success', 500, 500 FROM agent_session;
      INSERT INTO agent_session_message (id, session_id, role, parent_id, data, status, created_at, updated_at)
      SELECT id || '-tip', id, 'assistant', id || '-first', '{"parts":[]}', 'success', 300, 300 FROM agent_session;
      UPDATE agent_session SET active_node_id = 'flat-tip' WHERE id = 'branched';
      UPDATE agent_session SET active_node_id = 'missing' WHERE id = 'missing-head';
      UPDATE agent_session SET active_node_id = 'valid-head-first' WHERE id = 'valid-head';
    `)

    applyMigrations(dbh.db, resolveMigrationsPath())

    for (const id of ['flat', 'branched', 'missing-head']) {
      expect(readAgentSessionPath(dbh.db, id).map((row) => row.id)).toEqual([`${id}-first`, `${id}-tip`])
    }
    expect(readAgentSessionPath(dbh.db, 'valid-head').map((row) => row.id)).toEqual(['valid-head-first'])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})

describe('Session tree upgrade before tree fields existed', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0032_agent_message_tree' })

  it('upgrades populated pre-tree databases including multiple empty sessions', () => {
    dbh.sqlite.exec(`
      INSERT INTO agent_workspace (id, name, path, order_key, created_at, updated_at)
      VALUES ('work', 'Work', '/work', 'a0', 10, 20);
      INSERT INTO agent_session (id, name, workspace_id, order_key, created_at, updated_at, last_activity_at)
      VALUES ('flat', 'Flat', 'work', 'a0', 10, 20, 10), ('empty', 'Empty', 'work', 'a1', 10, 20, 10);
      INSERT INTO agent_session_message (id, session_id, role, data, status, created_at, updated_at)
      VALUES ('old', 'flat', 'user', '{"parts":[{"type":"text","text":"old archive"}]}', 'success', 100, 200);
      UPDATE agent_session_message SET searchable_text = 'old archive' WHERE id = 'old';
    `)
    applyMigrations(dbh.db, resolveMigrationsPath())
    expect(readAgentSessionPath(dbh.db, 'flat').map((row) => row.id)).toEqual(['old'])
    expect(dbh.db.select().from(messages).where(eq(messages.role, 'root')).all()).toHaveLength(2)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    expect(
      dbh.sqlite
        .prepare(
          "SELECT count(*) AS count FROM agent_session_message_fts WHERE agent_session_message_fts MATCH 'archive'"
        )
        .get()
    ).toEqual({ count: 1 })
    dbh.sqlite.exec(
      "INSERT INTO agent_session_message_fts(agent_session_message_fts, rank) VALUES ('integrity-check', 1)"
    )
    dbh.db.delete(sessions).where(eq(sessions.id, 'empty')).run()
    dbh.db.delete(sessions).where(eq(sessions.id, 'flat')).run()
    expect(dbh.db.select().from(messages).all()).toEqual([])
    dbh.sqlite.exec(
      "INSERT INTO agent_session_message_fts(agent_session_message_fts, rank) VALUES ('integrity-check', 1)"
    )
  })
})
