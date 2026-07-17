// Unit tests for SqliteBackupStripper — export step 2.5 (runs on EVERY preset).
//
// Seeds the lite-excluded tables + ALWAYS_STRIP tables (app_state) + their junction
// referrers (in included domains) + a few included rows, snapshots the live test DB
// to a copy, strips the copy, and asserts: stripped tables → 0 rows, cross-domain
// junction referrers cascade-pruned, included rows preserved. A control test proves
// `PRAGMA foreign_keys = ON` is load-bearing — without it cascade never fires and
// junction referrers are left dangling.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DbTableName } from '@main/data/db/backup/dbSchemaRefs'
import { appStateTable } from '@main/data/db/schemas/appState'
import { assistantTable } from '@main/data/db/schemas/assistant'
import { assistantKnowledgeBaseTable } from '@main/data/db/schemas/assistantRelations'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { chatMessageFileRefTable, paintingFileRefTable } from '@main/data/db/schemas/fileRelations'
import { knowledgeBaseTable, knowledgeItemTable } from '@main/data/db/schemas/knowledge'
import { messageTable } from '@main/data/db/schemas/message'
import { paintingTable } from '@main/data/db/schemas/painting'
import { topicTable } from '@main/data/db/schemas/topic'
import { translateHistoryTable } from '@main/data/db/schemas/translateHistory'
import { translateLanguageTable } from '@main/data/db/schemas/translateLanguage'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { SqliteBackupStripper } from '../ExcludedDomainStripper'

/**
 * assistant.settings minimal valid shape (NOT NULL JSON column — must satisfy
 * any consumer that reads these keys, but the DB column itself only enforces
 * NOT NULL on the JSON blob, not its inner shape).
 */
const ASSISTANT_SETTINGS = {
  temperature: 1.0,
  enableTemperature: false,
  topP: 1,
  enableTopP: false,
  maxTokens: 4096,
  enableMaxTokens: false,
  streamOutput: true,
  reasoning_effort: 'default',
  mcpMode: 'auto' as const,
  maxToolCalls: 20,
  enableMaxToolCalls: true,
  enableWebSearch: false,
  enableGenerateImage: false,
  customParameters: []
}

/**
 * Seed every lite-excluded table + ALWAYS_STRIP app_state + its junction referrers
 * + included anchors. Uses explicit ids so FK references are stable and readable.
 */
async function seedAll(dbh: ReturnType<typeof setupTestDatabase>): Promise<void> {
  // Included anchors (MUST survive strip).
  await dbh.db.insert(topicTable).values([{ id: 'tpc1', name: 'T', isNameManuallyEdited: false, orderKey: 'a' }])
  await dbh.db.insert(messageTable).values([
    {
      id: 'msg1',
      topicId: 'tpc1',
      role: 'root',
      parentId: null,
      data: { parts: [] },
      searchableText: '',
      status: 'success',
      siblingsGroupId: 0
    }
  ])
  await dbh.db
    .insert(assistantTable)
    .values([
      { id: 'ast1', name: 'A', prompt: '', emoji: '🤖', description: '', settings: ASSISTANT_SETTINGS, orderKey: 'a' }
    ])
  // FILE_STORAGE (excluded) + TOPICS junction referrer (cross-domain cascade-prune target).
  await dbh.db.insert(fileEntryTable).values([{ id: 'f1', origin: 'internal', name: 'test', ext: 'txt', size: 5 }])
  await dbh.db
    .insert(chatMessageFileRefTable)
    .values([{ id: 'cmfr1', fileEntryId: 'f1', sourceId: 'msg1', role: 'attachment' }])
  // KNOWLEDGE (excluded) + member + ASSISTANTS junction referrer (cross-domain cascade-prune target).
  await dbh.db
    .insert(knowledgeBaseTable)
    .values([{ id: 'kb1', name: 'KB', status: 'completed', chunkSize: 500, chunkOverlap: 50 }])
  await dbh.db
    .insert(knowledgeItemTable)
    .values([{ id: 'ki1', baseId: 'kb1', type: 'file', data: { source: 'file', url: '' }, status: 'completed' }])
  await dbh.db.insert(assistantKnowledgeBaseTable).values([{ assistantId: 'ast1', knowledgeBaseId: 'kb1' }])
  // PAINTINGS (excluded) + its junction (same-domain cascade + cross-domain to file_entry).
  await dbh.db
    .insert(paintingTable)
    .values([{ id: 'pt1', providerId: 'openai', modelId: 'dall-e-3', prompt: 'p', orderKey: 'a' }])
  await dbh.db.insert(paintingFileRefTable).values([{ id: 'pfr1', fileEntryId: 'f1', sourceId: 'pt1', role: 'output' }])
  // TRANSLATE_HISTORY (excluded) + member (zero external referrers).
  await dbh.db.insert(translateLanguageTable).values([{ langCode: 'en', value: 'English', emoji: '🇺🇸' }])
  await dbh.db.insert(translateHistoryTable).values([{ id: 'th1', sourceText: 'hi', targetText: 'hello', star: false }])
  // app_state (ALWAYS_STRIP) — runtime process state, not user data; stripped on every export.
  await dbh.db.insert(appStateTable).values([{ key: 'migration_v2_status', value: 'completed' }])
}

/** Open a readonly counter on a copy; caller MUST close() when done. */
function openCounter(copyPath: string): { count: (table: string) => number; close: () => void } {
  const db = new Database(copyPath, { readonly: true })
  return {
    count: (table: string) => (db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c,
    close: () => db.close()
  }
}

/** The 7 lite-excluded tables (FILE_STORAGE + KNOWLEDGE + PAINTINGS + TRANSLATE_HISTORY owned). */
const EXCLUDED_TABLES = [
  'file_entry',
  'knowledge_base',
  'knowledge_item',
  'painting',
  'painting_file_ref',
  'translate_language',
  'translate_history'
] as const

/** Global ALWAYS_STRIP physical tables (in DB_TABLES; FTS5 virtuals are NOT stripped). */
const ALWAYS_STRIP_PHYSICAL = ['app_state', 'job'] as const

/**
 * Combined strip set the orchestrator hands the stripper on lite (excluded +
 * ALWAYS_STRIP physical). Mirrors ExportOrchestrator.resolveStripTables('lite') —
 * kept here as a literal so this stripper unit test does not depend on the registry.
 * FTS5 virtual tables are absent: external-content index binds to the content table
 * (cannot be stripped independently); restore rebuilds.
 */
const STRIP_TABLES: readonly DbTableName[] = [...EXCLUDED_TABLES, ...ALWAYS_STRIP_PHYSICAL]

/** Cross-domain junction referrers living in INCLUDED domains — cascade-pruned. */
const JUNCTION_REFERRERS = ['chat_message_file_ref', 'assistant_knowledge_base'] as const

/** Included-domain rows that must survive strip. */
const INCLUDED_TABLES = ['topic', 'message', 'assistant'] as const

describe('SqliteBackupStripper', () => {
  const dbh = setupTestDatabase()

  it('deletes every stripped table to 0 rows (lite excluded + ALWAYS_STRIP)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-strip-'))
    try {
      await seedAll(dbh)
      const copy = join(dir, 'backup.sqlite')
      await dbh.sqlite.backup(copy) // simulate DbService.backupTo producing backup.sqlite

      const stripper = new SqliteBackupStripper()
      const stripped = await stripper.strip(copy, STRIP_TABLES)

      // The strip report covers exactly the combined strip set (9 tables: 7 excluded
      // + app_state/job physical). FTS5 virtuals are NOT in the set (external-content
      // index binds to content; restore rebuilds — see exclusions.ts).
      expect(new Set(stripped.map((s) => s.table))).toEqual(new Set(STRIP_TABLES))
      // Each stripped table is empty after strip.
      const counter = openCounter(copy)
      try {
        for (const t of STRIP_TABLES) {
          expect(counter.count(t), `${t} should be empty after strip`).toBe(0)
        }
      } finally {
        counter.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('cascade-prunes cross-domain junction referrers (chat_message_file_ref / assistant_knowledge_base)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-strip-cascade-'))
    try {
      await seedAll(dbh)
      const copy = join(dir, 'backup.sqlite')
      await dbh.sqlite.backup(copy)

      const stripper = new SqliteBackupStripper()
      await stripper.strip(copy, STRIP_TABLES)

      // Junction referrers in INCLUDED domains are pruned by schema CASCADE when
      // their excluded target (file_entry / knowledge_base) is deleted.
      const counter = openCounter(copy)
      try {
        for (const t of JUNCTION_REFERRERS) {
          expect(counter.count(t), `${t} should be cascade-pruned`).toBe(0)
        }
      } finally {
        counter.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('preserves included-domain rows (topic / message / assistant)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-strip-keep-'))
    try {
      await seedAll(dbh)
      const copy = join(dir, 'backup.sqlite')
      await dbh.sqlite.backup(copy)

      const stripper = new SqliteBackupStripper()
      await stripper.strip(copy, STRIP_TABLES)

      // Included aggregate roots + members survive — junction prune only removes
      // the referrer row, never the included aggregate.
      const counter = openCounter(copy)
      try {
        for (const t of INCLUDED_TABLES) {
          expect(counter.count(t), `${t} should be untouched`).toBe(1)
        }
      } finally {
        counter.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('control: without PRAGMA foreign_keys=ON, cascade does NOT fire (junction referrers dangle)', async () => {
    // Proves the `pragma('foreign_keys = ON')` call in SqliteBackupStripper is
    // load-bearing. A raw DELETE with foreign_keys OFF (the copy's default state
    // after online backup) removes the excluded rows but leaves junction referrers
    // pointing at now-deleted ids — exactly the dangling state the stripper avoids.
    const dir = await mkdtemp(join(tmpdir(), 'cs-strip-control-'))
    try {
      await seedAll(dbh)
      const copy = join(dir, 'backup.sqlite')
      await dbh.sqlite.backup(copy)

      // Raw DELETE WITHOUT the stripper's pragma. A fresh better-sqlite3 connection's
      // `foreign_keys` default varies by version, so pin it OFF explicitly to remove
      // any ambiguity — this proves the stripper's `pragma('foreign_keys = ON')` is
      // what makes CASCADE fire.
      const db = new Database(copy)
      try {
        db.pragma('foreign_keys = OFF')
        db.transaction(() => {
          // The cascade chain lives on the excluded tables (file_entry / knowledge_base);
          // ALWAYS_STRIP tables (app_state / job) have no cross-domain referrers, so the
          // control only DELETEs the excluded set to demonstrate the dangle.
          for (const t of EXCLUDED_TABLES) db.exec(`DELETE FROM "${t}"`)
        })()
      } finally {
        db.close()
      }

      // Excluded tables are empty (DELETE ran)...
      // ...but junction referrers are NOT pruned (cascade never fired) → dangling.
      const counter = openCounter(copy)
      try {
        for (const t of EXCLUDED_TABLES) {
          expect(counter.count(t), `${t} deleted by raw DELETE`).toBe(0)
        }
        for (const t of JUNCTION_REFERRERS) {
          expect(counter.count(t), `${t} dangles without foreign_keys=ON`).toBe(1)
        }
      } finally {
        counter.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
