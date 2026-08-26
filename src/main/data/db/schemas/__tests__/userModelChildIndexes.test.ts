/**
 * SQLite only enforces a foreign key's ON DELETE action efficiently when the CHILD key is
 * indexed. Without an index it re-scans the entire child table once per deleted parent row,
 * so deleting a provider's whole model list (hundreds of `user_model` rows) turns into
 * hundreds of full scans inside one synchronous write transaction — which blocks the main
 * process and freezes every window.
 *
 * Only the two unbounded child tables are covered: `message` and `agent_session_message` grow
 * with usage, while `assistant` / `agent` / `knowledge_base` hold tens of rows, where a scan
 * costs nothing.
 */

import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

const UNBOUNDED_CHILD_TABLES = ['message', 'agent_session_message'] as const

interface ForeignKeyRow {
  table: string
  from: string
}

interface IndexListRow {
  name: string
}

interface IndexInfoRow {
  seqno: number
  name: string | null
}

describe('user_model foreign keys on unbounded child tables', () => {
  const dbh = setupTestDatabase()

  it.each(UNBOUNDED_CHILD_TABLES)('indexes every %s column that references user_model', (table) => {
    const userModelColumns = (dbh.sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as ForeignKeyRow[])
      .filter((fk) => fk.table === 'user_model')
      .map((fk) => fk.from)

    expect(userModelColumns.length).toBeGreaterThan(0)

    const leftmostIndexedColumns = new Set(
      (dbh.sqlite.prepare(`PRAGMA index_list(${table})`).all() as IndexListRow[])
        .map((idx) => (dbh.sqlite.prepare(`PRAGMA index_info(${idx.name})`).all() as IndexInfoRow[])[0]?.name)
        .filter((column): column is string => column != null)
    )

    for (const column of userModelColumns) {
      expect(leftmostIndexedColumns).toContain(column)
    }
  })
})
