// FtsCentralHelper tests — FTS5 rebuild resync + integrity-check against the production schema.
//
// setupTestDatabase installs the real message_fts + agent_session_message_fts virtual tables,
// their trigram tokenizer, and the AFTER-INSERT/DELETE/UPDATE triggers — exactly what the helper
// runs against in production. A hand-built schema would drift on the tokenizer / column shape.
//
// The orphan case needs the AFTER-DELETE trigger (message_ad) temporarily removed so a shadow
// content DELETE leaves the FTS row intact (production triggers would otherwise sync the delete
// and mask the orphan). `withoutDeleteTrigger` drops it for the body and restores it in a finally
// so later tests see the full schema.

import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { FtsCentralHelper, FtsIntegrityCheckError } from '../FtsCentralHelper'

const dbh = setupTestDatabase()

/** Insert a row, auto-filling NOT NULL columns that have no DB default with a type-appropriate dummy. */
const seedRow = (table: string, overrides: Record<string, unknown>): void => {
  const cols = dbh.sqlite.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string
    type: string
    notnull: number
    dflt_value: string | null
  }[]
  const names: string[] = []
  const values: unknown[] = []
  for (const c of cols) {
    if (c.name in overrides) {
      names.push(c.name)
      values.push(overrides[c.name])
    } else if (c.notnull && c.dflt_value === null) {
      names.push(c.name)
      values.push(c.type === 'integer' ? 0 : '')
    }
  }
  const placeholders = names.map(() => '?').join(',')
  dbh.sqlite.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${placeholders})`).run(...values)
}

const seedMessage = (id: string, text = 'hello world'): void => {
  // Seed the topic first to satisfy message.topic_id FK, then the message. role 'root' + no
  // parent satisfies message_root_parent_check; data carries the text the trigger extracts into
  // searchable_text. The AFTER-INSERT trigger assigns fts_rowid + syncs the FTS index.
  seedRow('topic', { id: `t-${id}`, name: `topic-${id}` })
  seedRow('message', {
    id,
    topic_id: `t-${id}`,
    role: 'root',
    status: 'success',
    data: `{"parts":[{"type":"text","text":"${text}"}]}`
  })
}

/** Drop message_ad for `body`, then restore it (keeps the schema intact for later tests). */
const withoutDeleteTrigger = (body: () => void): void => {
  dbh.sqlite.prepare('DROP TRIGGER message_ad').run()
  try {
    body()
  } finally {
    dbh.sqlite
      .prepare(
        `CREATE TRIGGER message_ad AFTER DELETE ON message BEGIN
           INSERT INTO message_fts(message_fts, rowid, searchable_text)
           VALUES ('delete', OLD.fts_rowid, OLD.searchable_text);
         END`
      )
      .run()
  }
}

describe('FtsCentralHelper', () => {
  it('rebuild is idempotent and integrityCheck passes on a trigger-maintained index', () => {
    seedMessage('m1')
    seedMessage('m2')
    // Triggers maintain the FTS index on insert; rebuild is a no-op backstop here, and the
    // index is consistent with content.
    expect(() => FtsCentralHelper.rebuild(dbh.sqlite)).not.toThrow()
    expect(() => FtsCentralHelper.integrityCheck(dbh.sqlite)).not.toThrow()
  })

  it('integrityCheck throws FtsIntegrityCheckError after a shadow content DELETE (orphaned FTS row)', () => {
    seedMessage('m1')
    FtsCentralHelper.rebuild(dbh.sqlite)
    withoutDeleteTrigger(() => {
      // With message_ad gone, deleting the content row leaves the FTS row orphaned.
      dbh.sqlite.prepare('DELETE FROM message WHERE id = ?').run('m1')
      expect(() => FtsCentralHelper.integrityCheck(dbh.sqlite)).toThrow(FtsIntegrityCheckError)
    })
  })

  it('rebuild resyncs the index after an orphan (trigger bypass + content delete)', () => {
    seedMessage('m1')
    FtsCentralHelper.rebuild(dbh.sqlite)
    withoutDeleteTrigger(() => {
      dbh.sqlite.prepare('DELETE FROM message WHERE id = ?').run('m1')
      FtsCentralHelper.rebuild(dbh.sqlite) // resync FTS to surviving (empty) content
      expect(() => FtsCentralHelper.integrityCheck(dbh.sqlite)).not.toThrow()
    })
  })
})
