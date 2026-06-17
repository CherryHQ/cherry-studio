import { agentSessionTable } from '@data/db/schemas/agentSession'
import { AGENT_SESSION_MESSAGE_FTS_STATEMENTS, agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { MESSAGE_FTS_STATEMENTS, messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import type { Client } from '@libsql/client'
import { setupTestDatabase, withRoot } from '@test-helpers/db'
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

function integrityCheck1(client: Client, ftsTable: string): Promise<unknown> {
  return client.execute(`INSERT INTO ${ftsTable}(${ftsTable}, rank) VALUES('integrity-check', 1)`)
}

// Model drizzle's table rebuild: a plain `CREATE TABLE ... AS SELECT *` reassigns the implicit
// rowid (reshuffling it relative to any deleted-row holes) while copying every real column —
// including `fts_rowid` — verbatim. The FTS vtable is untouched, so it keeps its entries keyed by
// fts_rowid; re-running the custom SQL re-asserts the triggers on the rebuilt table.
async function rebuildWithRowidReshuffle(client: Client, table: string, ftsStatements: string[]): Promise<void> {
  await client.execute('PRAGMA foreign_keys=OFF')
  await client.execute(`CREATE TABLE __new_${table} AS SELECT * FROM ${table}`)
  await client.execute(`DROP TABLE ${table}`)
  await client.execute(`ALTER TABLE __new_${table} RENAME TO ${table}`)
  await client.execute('PRAGMA foreign_keys=ON')
  for (const stmt of ftsStatements) await client.execute(stmt)
}

async function ftsMatchIds(client: Client, table: string, ftsTable: string, term: string): Promise<string[]> {
  const res = await client.execute({
    sql: `SELECT m.id FROM ${table} m JOIN ${ftsTable} fts ON m.fts_rowid = fts.rowid WHERE ${ftsTable} MATCH ?`,
    args: [term]
  })
  return res.rows.map((row) => String(row[0]))
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
    expect(await ftsMatchIds(dbh.client, 'message', 'message_fts', 'cherry')).toEqual(['m3'])

    // Create a rowid hole in the middle, then rebuild (reshuffles the implicit rowid).
    await dbh.client.execute(`DELETE FROM message WHERE id = 'm2'`)
    await rebuildWithRowidReshuffle(dbh.client, 'message', MESSAGE_FTS_STATEMENTS)

    // The index is keyed on fts_rowid (carried through the rebuild), so it stays aligned.
    await expect(integrityCheck1(dbh.client, 'message_fts')).resolves.toBeDefined()
    expect(await ftsMatchIds(dbh.client, 'message', 'message_fts', 'cherry')).toEqual(['m3'])
    expect(await ftsMatchIds(dbh.client, 'message', 'message_fts', 'date')).toEqual(['m4'])
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
    expect(await ftsMatchIds(dbh.client, 'agent_session_message', 'agent_session_message_fts', 'cherry')).toEqual([
      'a3'
    ])

    await dbh.client.execute(`DELETE FROM agent_session_message WHERE id = 'a2'`)
    await rebuildWithRowidReshuffle(dbh.client, 'agent_session_message', AGENT_SESSION_MESSAGE_FTS_STATEMENTS)

    await expect(integrityCheck1(dbh.client, 'agent_session_message_fts')).resolves.toBeDefined()
    expect(await ftsMatchIds(dbh.client, 'agent_session_message', 'agent_session_message_fts', 'cherry')).toEqual([
      'a3'
    ])
    expect(await ftsMatchIds(dbh.client, 'agent_session_message', 'agent_session_message_fts', 'date')).toEqual(['a4'])
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
    await dbh.client.execute(`UPDATE message SET fts_rowid = NULL WHERE id = 'n1'`)
    await expect(integrityCheck1(dbh.client, 'message_fts')).rejects.toThrow()
  })
})
