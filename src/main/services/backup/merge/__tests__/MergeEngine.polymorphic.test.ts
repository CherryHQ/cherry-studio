// MergeEngine polymorphic association phase (A1) — entity_tag restore.
//
// Seeds TAGS_GROUPS + entity root domains and asserts: full row-count parity, lite
// domain drop, FIELD_MERGE tagId rewrite, unmapped entityType disclosure, local-only
// row preservation (ON CONFLICT DO NOTHING upsert, not replace).

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BackupDomain } from '@main/data/db/backup/domains'
import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { MergeContext, MergeResult } from '..'
import { MergeEngine } from '..'

const dbh = setupTestDatabase()
const registry = contributorManager.getRegistry()

let tmpDir: string
let backupPath: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'cs-poly-'))
  backupPath = join(tmpDir, 'backup.sqlite')
  await dbh.sqlite.backup(backupPath)
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

const seedBackup = (seed: (db: Database.Database) => void): void => {
  const db = new Database(backupPath)
  try {
    db.pragma('foreign_keys = ON')
    db.transaction(seed)(db)
  } finally {
    db.close()
  }
}

/**
 * Insert a row, auto-filling NOT NULL columns that have no DB default with a type-appropriate
 * dummy. Mirrors junctionPhase.test seedRow.
 */
const seedRow = (db: Database.Database, table: string, overrides: Record<string, unknown>): void => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
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
      values.push(c.type === 'integer' ? 0 : c.type === 'real' ? 0 : '')
    }
  }
  const placeholders = names.map(() => '?').join(',')
  db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${placeholders})`).run(...values)
}

const seedTag = (db: Database.Database, id: string, name = `tag-${id}`): void => {
  seedRow(db, 'tag', { id, name })
}

const seedAssistant = (db: Database.Database, id: string): void => {
  seedRow(db, 'assistant', { id, name: `a-${id}`, emoji: '🤖', settings: '{}' })
}

const seedTopic = (db: Database.Database, id: string): void => {
  seedRow(db, 'topic', { id, name: `t-${id}`, order_key: `ok-${id}` })
}

const seedKnowledgeBase = (db: Database.Database, id: string): void => {
  seedRow(db, 'knowledge_base', {
    id,
    name: `kb-${id}`,
    emoji: '📚',
    status: 'completed',
    chunk_size: 500,
    chunk_overlap: 50,
    search_mode: 'default'
  })
}

const seedEntityTag = (db: Database.Database, entityType: string, entityId: string, tagId: string): void => {
  seedRow(db, 'entity_tag', {
    entity_type: entityType,
    entity_id: entityId,
    tag_id: tagId
  })
}

const runMerge = (domains: readonly BackupDomain[]): Promise<MergeResult> =>
  new MergeEngine(registry).mergeBackupIntoWork(dbh.sqlite, dbh.db, {
    backupDbPath: backupPath,
    domains,
    skippedFileEntryIds: new Set<string>(),
    stagedFileEntryIds: new Set<string>()
  } satisfies MergeContext)

const entityTagRows = (): { entity_type: string; entity_id: string; tag_id: string }[] =>
  dbh.sqlite
    .prepare(`SELECT entity_type, entity_id, tag_id FROM entity_tag ORDER BY entity_type, entity_id, tag_id`)
    .all() as { entity_type: string; entity_id: string; tag_id: string }[]

const FULL_DOMAINS: readonly BackupDomain[] = [
  'TAGS_GROUPS',
  'ASSISTANTS',
  'TOPICS',
  'AGENTS',
  'KNOWLEDGE',
  'PROVIDERS'
]

const LITE_DOMAINS: readonly BackupDomain[] = ['TAGS_GROUPS', 'ASSISTANTS', 'TOPICS', 'AGENTS', 'PROVIDERS']

describe('importPolymorphicAssociationRows (entity_tag)', () => {
  it('full restore: entity_tag row count parity', async () => {
    seedBackup((db) => {
      seedTag(db, 'T1', 'favorite')
      seedAssistant(db, 'A1')
      seedTopic(db, 'topic-1')
      seedKnowledgeBase(db, 'kb-1')
      seedEntityTag(db, 'assistant', 'A1', 'T1')
      seedEntityTag(db, 'topic', 'topic-1', 'T1')
      seedEntityTag(db, 'knowledge', 'kb-1', 'T1')
    })

    await runMerge(FULL_DOMAINS)

    expect(entityTagRows()).toEqual([
      { entity_type: 'assistant', entity_id: 'A1', tag_id: 'T1' },
      { entity_type: 'knowledge', entity_id: 'kb-1', tag_id: 'T1' },
      { entity_type: 'topic', entity_id: 'topic-1', tag_id: 'T1' }
    ])
  })

  it('lite restore: knowledge-typed entity_tag rows dropped', async () => {
    seedBackup((db) => {
      seedTag(db, 'T1', 'favorite')
      seedAssistant(db, 'A1')
      seedTopic(db, 'topic-1')
      seedKnowledgeBase(db, 'kb-1')
      seedEntityTag(db, 'assistant', 'A1', 'T1')
      seedEntityTag(db, 'topic', 'topic-1', 'T1')
      seedEntityTag(db, 'knowledge', 'kb-1', 'T1')
    })

    const result = await runMerge(LITE_DOMAINS)

    expect(entityTagRows()).toEqual([
      { entity_type: 'assistant', entity_id: 'A1', tag_id: 'T1' },
      { entity_type: 'topic', entity_id: 'topic-1', tag_id: 'T1' }
    ])
    expect(
      result.degradedToSkips.some(
        (s) => s.table === 'entity_tag' && s.reason === 'polymorphic-target-domain-not-selected' && s.count >= 1
      )
    ).toBe(true)
  })

  it('FIELD_MERGE tag PK rewrite propagates to entity_tag.tagId', async () => {
    // Work holds the same tag name under a different uuid → FIELD_MERGE keeps local PK.
    seedTag(dbh.sqlite, 'T_local', 'favorite')
    seedAssistant(dbh.sqlite, 'A1')
    seedBackup((db) => {
      seedTag(db, 'T1', 'favorite')
      seedAssistant(db, 'A1')
      seedEntityTag(db, 'assistant', 'A1', 'T1')
    })

    await runMerge(['TAGS_GROUPS', 'ASSISTANTS'])

    expect(dbh.sqlite.prepare(`SELECT COUNT(*) AS c FROM entity_tag WHERE tag_id = 'T1'`).get()).toEqual({
      c: 0
    })
    expect(entityTagRows()).toEqual([{ entity_type: 'assistant', entity_id: 'A1', tag_id: 'T_local' }])
  })

  it('unmapped entityType → degradedToSkips + no insert', async () => {
    seedBackup((db) => {
      seedTag(db, 'T1', 'favorite')
      seedEntityTag(db, 'exotic', 'whatever', 'T1')
    })

    const result = await runMerge(['TAGS_GROUPS'])

    expect(entityTagRows()).toEqual([])
    expect(
      result.degradedToSkips.some(
        (s) => s.table === 'entity_tag' && s.reason === 'polymorphic-entityType-unmapped' && s.count === 1
      )
    ).toBe(true)
  })

  it('local-only entity_tag preserved (ON CONFLICT DO NOTHING upsert)', async () => {
    seedTag(dbh.sqlite, 'T_local', 'local-tag')
    seedAssistant(dbh.sqlite, 'A_local')
    seedEntityTag(dbh.sqlite, 'assistant', 'A_local', 'T_local')

    seedBackup((db) => {
      seedTag(db, 'T1', 'backup-tag')
      seedAssistant(db, 'A1')
      seedEntityTag(db, 'assistant', 'A1', 'T1')
    })

    await runMerge(['TAGS_GROUPS', 'ASSISTANTS'])

    expect(entityTagRows()).toEqual([
      { entity_type: 'assistant', entity_id: 'A1', tag_id: 'T1' },
      { entity_type: 'assistant', entity_id: 'A_local', tag_id: 'T_local' }
    ])
  })

  it('tagId not in identityMap → row dropped with polymorphic-tag-target-missing', async () => {
    // Tag exists only in work under a different name; backup tag natural-key conflicts and
    // FIELD_MERGE maps T1→T_local. Plant an entity_tag that references a tag id that was
    // never imported (orphan tag id in backup) — seed with FK off so the orphan can exist.
    seedTag(dbh.sqlite, 'T_local', 'favorite')
    seedAssistant(dbh.sqlite, 'A1')
    const db = new Database(backupPath)
    try {
      db.pragma('foreign_keys = OFF')
      db.transaction((tx) => {
        seedTag(tx, 'T1', 'favorite')
        seedAssistant(tx, 'A1')
        // Orphan tag id — not present as a tag row, so never enters identityMap.
        seedEntityTag(tx, 'assistant', 'A1', 'T_orphan')
      })(db)
    } finally {
      db.close()
    }

    const result = await runMerge(['TAGS_GROUPS', 'ASSISTANTS'])

    expect(entityTagRows().filter((r) => r.tag_id === 'T_orphan')).toEqual([])
    expect(
      result.degradedToSkips.some((s) => s.table === 'entity_tag' && s.reason === 'polymorphic-tag-target-missing')
    ).toBe(true)
  })
})
