import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { agentSessionTable as sessions } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable as messages } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService as service } from '@data/services/AgentSessionMessageService'
import { readAgentSessionPath } from '@data/services/agentSessionMessageTree'

function seedSessions(dbh: ReturnType<typeof setupTestDatabase>) {
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: 'work', name: 'Work', path: '/work', type: 'user', orderKey: 'a0' })
    .run()
  dbh.db
    .insert(sessions)
    .values(
      ['flat', 'branched'].map((id) => ({
        id,
        name: id,
        workspaceId: 'work',
        orderKey: id,
        createdAt: 10,
        updatedAt: 20
      }))
    )
    .run()
}

describe('Session tree storage constraints', () => {
  const dbh = setupTestDatabase()

  it('rejects dangling and cross-session parents, root mismatches and direct parent deletion', () => {
    seedSessions(dbh)
    const root = service.captureHead('flat')
    const other = service.captureHead('branched')
    const insert = (role: string, parentId: string | null) =>
      dbh.db
        .insert(messages)
        .values({ sessionId: 'flat', role, parentId, status: 'success', data: { parts: [] } })
        .run()
    expect(() => insert('user', null)).toThrow()
    expect(() => insert('user', 'missing')).toThrow()
    expect(() => insert('user', other)).toThrow()
    expect(() => insert('root', root)).toThrow()
    const first = service.saveMessage({ sessionId: 'flat', message: { role: 'user', data: { parts: [] } } })
    const second = service.saveMessage({ sessionId: 'flat', message: { role: 'assistant', data: { parts: [] } } })
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
        tx.insert(messages)
          .values({ id, sessionId: 'flat', parentId, role: 'user', status: 'success', data: { parts: [] } })
          .run()
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
        updatedAt: i + 200
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
        (id, session_id, role, parent_id, data, status, runtime_resume_token, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'success', ?, 100, 200)
    `)
    for (const id of ['b', 'a']) {
      insert.run(
        id,
        'flat',
        'user',
        null,
        JSON.stringify({ parts: [{ type: 'text', text: `searchable ${id}` }] }),
        'native'
      )
    }
    insert.run('root', 'branched', 'root', null, '{"parts":[]}', null)
    insert.run('first', 'branched', 'user', 'root', '{"parts":[]}', null)
    insert.run('second', 'branched', 'user', 'root', '{"parts":[]}', null)
    dbh.sqlite.prepare("UPDATE agent_session SET active_node_id = 'first' WHERE id = 'branched'").run()
    const before = dbh.sqlite
      .prepare<[], { id: string; session_id: string }>('SELECT * FROM agent_session_message ORDER BY id')
      .all()
    const sessionBefore = dbh.sqlite.prepare("SELECT * FROM agent_session WHERE id = 'branched'").get()
    applyMigrations(dbh.db, resolveMigrationsPath())
    expect(readAgentSessionPath(dbh.db, 'flat').map((row) => row.id)).toEqual(['a', 'b'])
    for (const row of before) {
      expect(dbh.sqlite.prepare('SELECT * FROM agent_session_message WHERE id = ?').get(row.id)).toMatchObject(
        row.session_id === 'flat' ? { ...row, parent_id: expect.any(String) } : row
      )
    }
    expect(dbh.sqlite.prepare("SELECT * FROM agent_session WHERE id = 'branched'").get()).toEqual(sessionBefore)
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

for (const invalidParent of ['missing', 'foreign']) {
  describe(`Session tree upgrade with ${invalidParent} parent`, () => {
    const dbh = setupTestDatabase({ beforeMigration: '0039_agent_session_tree_backfill' })

    it('rejects invalid edges and rolls back the entire upgrade without changing rows', () => {
      seedSessions(dbh)
      dbh.sqlite.exec(`
        INSERT INTO agent_session_message (id, session_id, role, data, status, created_at, updated_at)
        VALUES ('other-root', 'branched', 'root', '{"parts":[]}', 'success', 100, 200);
      `)
      dbh.sqlite
        .prepare(`
          INSERT INTO agent_session_message (id, session_id, parent_id, role, data, status, created_at, updated_at)
          VALUES ('broken', 'flat', ?, 'user', '{"parts":[]}', 'success', 100, 200)
        `)
        .run(invalidParent === 'missing' ? 'missing' : 'other-root')
      const before = dbh.sqlite.prepare('SELECT * FROM agent_session_message ORDER BY id').all()
      const migrationsBefore = dbh.sqlite.prepare('SELECT * FROM __drizzle_migrations').all()
      expect(() => applyMigrations(dbh.db, resolveMigrationsPath())).toThrow(
        expect.objectContaining({
          cause: expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' })
        })
      )
      expect(dbh.sqlite.prepare('SELECT * FROM agent_session_message ORDER BY id').all()).toEqual(before)
      expect(dbh.sqlite.prepare('SELECT * FROM __drizzle_migrations').all()).toEqual(migrationsBefore)
      expect(dbh.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    })
  })
}

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
