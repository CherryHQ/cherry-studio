import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

/**
 * Regression guard for the search-reasoning-leak privacy fix.
 *
 * Databases shipped before the fix stored the model's hidden reasoning text in
 * `agent_session_message.searchable_text` (and its FTS index), so global-search snippets leaked
 * chain-of-thought that the session UI never rendered. The corrected triggers only fix future
 * writes; the shipped data-migration (0001) must scrub the reasoning out of existing rows.
 *
 * This test reproduces a pre-fix row (searchable_text + FTS index carrying reasoning), replays the
 * shipped migration's backfill statements, and asserts the reasoning is gone while `text` survives.
 */

function readBackfillStatements(): string[] {
  const dir = resolveMigrationsPath()
  const file = readdirSync(dir).find((name) => /^0001_.*\.sql$/.test(name))
  if (!file) throw new Error('0001 backfill migration not found')
  return readFileSync(join(dir, file), 'utf-8')
    .split('--> statement-breakpoint')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
}

function ftsMatchIds(sqlite: Database.Database, term: string): string[] {
  return (
    sqlite
      .prepare(
        `SELECT m.id FROM agent_session_message m
           JOIN agent_session_message_fts fts ON m.fts_rowid = fts.rowid
           WHERE agent_session_message_fts MATCH ?`
      )
      .all(term) as Array<{ id: string }>
  ).map((row) => String(row.id))
}

describe('agent session message reasoning backfill (migration 0001)', () => {
  const dbh = setupTestDatabase()

  it('scrubs reasoning from existing searchable_text and the FTS index', () => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'ws-1', name: 'ws-1', path: '/tmp/ws-1', type: 'user', orderKey: 'w0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'sess-1', name: 'Session', workspaceId: 'ws-1', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: 'msg-1',
        sessionId: 'sess-1',
        role: 'assistant',
        data: {
          parts: [
            { type: 'reasoning', text: 'SECRETTHOUGHT analysing the user request' },
            { type: 'text', text: 'WORKOK' }
          ]
        },
        status: 'success',
        createdAt: 10,
        updatedAt: 10
      })
      .run()

    // Simulate the pre-fix stored state: searchable_text (and therefore the FTS index) carries the
    // reasoning text. Overwrite the column directly (UPDATE OF searchable_text does not fire the
    // AFTER UPDATE OF data trigger) and rebuild the index from it.
    dbh.sqlite
      .prepare(`UPDATE agent_session_message SET searchable_text = ? WHERE id = 'msg-1'`)
      .run('SECRETTHOUGHT analysing the user request\nWORKOK')
    dbh.sqlite.exec(`INSERT INTO agent_session_message_fts(agent_session_message_fts) VALUES ('rebuild')`)

    // Pre-condition: the leak is reproducible — reasoning is searchable.
    expect(ftsMatchIds(dbh.sqlite, 'SECRETTHOUGHT')).toEqual(['msg-1'])

    for (const statement of readBackfillStatements()) dbh.sqlite.exec(statement)

    const row = dbh.sqlite
      .prepare(`SELECT searchable_text AS text FROM agent_session_message WHERE id = 'msg-1'`)
      .get() as { text: string }
    expect(row.text).toBe('WORKOK')
    expect(ftsMatchIds(dbh.sqlite, 'SECRETTHOUGHT')).toHaveLength(0)
    expect(ftsMatchIds(dbh.sqlite, 'WORKOK')).toEqual(['msg-1'])
  })
})
