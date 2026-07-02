import { agentSessionTable } from '@data/db/schemas/agentSession'
import { AGENT_SESSION_MESSAGE_FTS_STATEMENTS, agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { MESSAGE_FTS_STATEMENTS, messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { setupTestDatabase, withRoot } from '@test-helpers/db'
import type Database from 'better-sqlite3'
import { isNull } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

/**
 * Regression guard for the FTS5-rowid-reshuffle bug.
 *
 * Both chat FTS tables are external-content and keyed on a stable `fts_rowid` column (NOT the
 * implicit rowid). SQLite reshuffles the implicit rowid on a table rebuild (drizzle's
 * `INSERT...SELECT` drops it) and on VACUUM; an index keyed on the implicit rowid would then
 * silently point at the wrong rows. These tests reproduce a rowid-reshuffling rebuild and assert
 * the index stays aligned — the only reliable detector is `integrity-check, 1` (the default
 * `integrity-check` is unreliable here). The index MUST be populated before the rebuild, or an
 * empty index cannot expose the bug.
 */

function integrityCheck1(sqlite: Database.Database, ftsTable: string): Database.RunResult {
  return sqlite.prepare(`INSERT INTO ${ftsTable}(${ftsTable}, rank) VALUES('integrity-check', 1)`).run()
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

// Model drizzle's table rebuild without permanently replacing the production schema: copy rows
// through a plain `CREATE TABLE ... AS SELECT *` temp table so re-inserting them reassigns the
// implicit rowid (reshuffling it relative to any deleted-row holes) while copying every real column
// — including `fts_rowid` — verbatim. FTS triggers are dropped during the delete/re-insert, so the
// FTS vtable is untouched and keeps its entries keyed by fts_rowid; re-running the custom SQL
// re-asserts the triggers on the rebuilt table.
function rebuildWithRowidReshuffle(sqlite: Database.Database, table: string, ftsStatements: string[]): void {
  const quotedTable = quoteIdent(table)
  const copyTable = quoteIdent(`__fts_rebuild_${table}`)
  const columns = (sqlite.pragma(`table_info(${quotedTable})`) as Array<{ name: string }>).map((row) => row.name)
  const columnList = columns.map(quoteIdent).join(', ')

  sqlite.pragma('foreign_keys=OFF')
  for (const stmt of ftsStatements) {
    if (/^\s*DROP\s+TRIGGER\b/i.test(stmt)) sqlite.exec(stmt)
  }
  sqlite.exec(`CREATE TEMP TABLE ${copyTable} AS SELECT * FROM ${quotedTable}`)
  sqlite.exec(`DELETE FROM ${quotedTable}`)
  sqlite.exec(`INSERT INTO ${quotedTable} (${columnList}) SELECT ${columnList} FROM ${copyTable}`)
  sqlite.exec(`DROP TABLE ${copyTable}`)
  sqlite.pragma('foreign_keys=ON')
  for (const stmt of ftsStatements) sqlite.exec(stmt)
}

function ftsMatchIds(sqlite: Database.Database, table: string, ftsTable: string, term: string): string[] {
  const rows = sqlite
    .prepare(`SELECT m.id FROM ${table} m JOIN ${ftsTable} fts ON m.fts_rowid = fts.rowid WHERE ${ftsTable} MATCH ?`)
    .all(term) as Array<{ id: string }>
  return rows.map((row) => String(row.id))
}

describe('FTS5 rowid-reshuffle resistance (fts_rowid keying)', () => {
  const dbh = setupTestDatabase()

  it('message_fts stays aligned after a rowid-reshuffling table rebuild', async () => {
    await dbh.db.insert(topicTable).values({ id: 'topic-fts', activeNodeId: 'm4', orderKey: 'a0' })
    // Four content rows as siblings under the virtual root, so deleting a middle one does NOT
    // cascade via the self-FK (ON DELETE CASCADE) and we still get a rowid hole.
    await dbh.db.insert(messageTable).values(
      withRoot('topic-fts', [
        {
          id: 'm1',
          parentId: null,
          topicId: 'topic-fts',
          role: 'user',
          data: { parts: [{ type: 'text', text: 'alpha apple' }] },
          status: 'success',
          createdAt: 10,
          updatedAt: 10
        },
        {
          id: 'm2',
          parentId: null,
          topicId: 'topic-fts',
          role: 'assistant',
          data: { parts: [{ type: 'text', text: 'bravo banana' }] },
          status: 'success',
          createdAt: 20,
          updatedAt: 20
        },
        {
          id: 'm3',
          parentId: null,
          topicId: 'topic-fts',
          role: 'assistant',
          data: { parts: [{ type: 'text', text: 'charlie cherry' }] },
          status: 'success',
          createdAt: 30,
          updatedAt: 30
        },
        {
          id: 'm4',
          parentId: null,
          topicId: 'topic-fts',
          role: 'assistant',
          data: { parts: [{ type: 'text', text: 'delta date' }] },
          status: 'success',
          createdAt: 40,
          updatedAt: 40
        }
      ])
    )

    // Trigger wiring: every row got a non-null fts_rowid, and the FTS join resolves the right row.
    const noNullBefore = await dbh.db.select().from(messageTable).where(isNull(messageTable.ftsRowid))
    expect(noNullBefore).toHaveLength(0)
    expect(ftsMatchIds(dbh.sqlite, 'message', 'message_fts', 'cherry')).toEqual(['m3'])

    // Create a rowid hole in the middle, then rebuild (reshuffles the implicit rowid).
    dbh.sqlite.exec(`DELETE FROM message WHERE id = 'm2'`)
    rebuildWithRowidReshuffle(dbh.sqlite, 'message', MESSAGE_FTS_STATEMENTS)

    // The index is keyed on fts_rowid (carried through the rebuild), so it stays aligned.
    expect(integrityCheck1(dbh.sqlite, 'message_fts')).toBeDefined()
    expect(ftsMatchIds(dbh.sqlite, 'message', 'message_fts', 'cherry')).toEqual(['m3'])
    expect(ftsMatchIds(dbh.sqlite, 'message', 'message_fts', 'date')).toEqual(['m4'])
    const noNullAfter = await dbh.db.select().from(messageTable).where(isNull(messageTable.ftsRowid))
    expect(noNullAfter).toHaveLength(0)
  })

  it('agent_session_message_fts stays aligned after a rowid-reshuffling table rebuild', async () => {
    await dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'ws-1', name: 'ws-1', path: '/tmp/ws-1', type: 'user', orderKey: 'w0' })
    await dbh.db
      .insert(agentSessionTable)
      .values({ id: 'sess-1', name: 'Session', workspaceId: 'ws-1', orderKey: 'a0' })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: 'a1',
        sessionId: 'sess-1',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'alpha apple' }] },
        status: 'success',
        createdAt: 10,
        updatedAt: 10
      },
      {
        id: 'a2',
        sessionId: 'sess-1',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'bravo banana' }] },
        status: 'success',
        createdAt: 20,
        updatedAt: 20
      },
      {
        id: 'a3',
        sessionId: 'sess-1',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'charlie cherry' }] },
        status: 'success',
        createdAt: 30,
        updatedAt: 30
      },
      {
        id: 'a4',
        sessionId: 'sess-1',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'delta date' }] },
        status: 'success',
        createdAt: 40,
        updatedAt: 40
      }
    ])

    const noNullBefore = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(isNull(agentSessionMessageTable.ftsRowid))
    expect(noNullBefore).toHaveLength(0)
    expect(ftsMatchIds(dbh.sqlite, 'agent_session_message', 'agent_session_message_fts', 'cherry')).toEqual(['a3'])

    dbh.sqlite.exec(`DELETE FROM agent_session_message WHERE id = 'a2'`)
    rebuildWithRowidReshuffle(dbh.sqlite, 'agent_session_message', AGENT_SESSION_MESSAGE_FTS_STATEMENTS)

    expect(integrityCheck1(dbh.sqlite, 'agent_session_message_fts')).toBeDefined()
    expect(ftsMatchIds(dbh.sqlite, 'agent_session_message', 'agent_session_message_fts', 'cherry')).toEqual(['a3'])
    expect(ftsMatchIds(dbh.sqlite, 'agent_session_message', 'agent_session_message_fts', 'date')).toEqual(['a4'])
    const agentNoNullAfter = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(isNull(agentSessionMessageTable.ftsRowid))
    expect(agentNoNullAfter).toHaveLength(0)
  })

  it('integrity-check,1 catches a NULL fts_rowid desync (guards the nullable-window hazard)', async () => {
    await dbh.db.insert(topicTable).values({ id: 'topic-null', activeNodeId: 'n1', orderKey: 'b0' })
    await dbh.db.insert(messageTable).values(
      withRoot('topic-null', [
        {
          id: 'n1',
          parentId: null,
          topicId: 'topic-null',
          role: 'user',
          data: { parts: [{ type: 'text', text: 'orphan text here' }] },
          status: 'success',
          createdAt: 10,
          updatedAt: 10
        }
      ])
    )

    // Simulate a row that lost its fts_rowid (e.g. a future bulk insert/restore that bypassed the
    // trigger): the FTS entry now references content that no longer carries that key. This is the
    // failure mode the nullable column risks — integrity-check,1 MUST surface it as corruption.
    dbh.sqlite.exec(`UPDATE message SET fts_rowid = NULL WHERE id = 'n1'`)
    expect(() => integrityCheck1(dbh.sqlite, 'message_fts')).toThrow()
  })
})
