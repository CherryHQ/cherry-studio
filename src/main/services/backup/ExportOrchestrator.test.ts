// Unit tests for ExportOrchestrator — .cbu production (full-preset, DB + blob slice).
import Database from 'better-sqlite3'
import StreamZip from 'node-stream-zip'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ReadonlyBackupRegistry } from '@main/data/db/backup/contributorTypes'
import { BACKUP_DOMAINS } from '@main/data/db/backup/domains'
import { appStateTable } from '@main/data/db/schemas/appState'
import { assistantKnowledgeBaseTable } from '@main/data/db/schemas/assistantRelations'
import { assistantTable } from '@main/data/db/schemas/assistant'
import { chatMessageFileRefTable } from '@main/data/db/schemas/fileRelations'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { knowledgeBaseTable } from '@main/data/db/schemas/knowledge'
import { messageTable } from '@main/data/db/schemas/message'
import { topicTable } from '@main/data/db/schemas/topic'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { SqliteBackupCopier, StubBackupCopier } from './BackupDbCopier'
import { SqliteBackupStripper, StubStripper } from './ExcludedDomainStripper'
import { ExportOrchestrator } from './ExportOrchestrator'
import { contributorManager } from './contributors/ContributorManager'

/**
 * Minimal registry stub — the orchestrator's first slice only calls `topoSort`.
 * Real registry integration (real topoSort by reference deps) is covered by the
 * finalize/registry tests; this stub isolates the export pipeline.
 */
const STUB_REGISTRY = {
  // topoSort + getOperations(→ undefined) only; isolates the export pipeline from
  // the real registry. getOperations returns undefined so collectFileResources is
  // skipped (no blobs) — the e2e describe below uses the real registry.
  topoSort: (domains: readonly string[]) => [...domains],
  getOperations: () => undefined
} as unknown as ReadonlyBackupRegistry

/** Create a fixture sqlite file with rows so the archive's backup.sqlite is verifiable. */
const makeFixtureDb = async (fixturePath: string): Promise<void> => {
  const db = new Database(fixturePath)
  db.exec('CREATE TABLE t(x INTEGER)')
  db.exec('INSERT INTO t VALUES (1), (2)')
  db.close()
}

const openZip = async (p: string) => {
  const zip = new StreamZip.async({ file: p })
  const entries = Object.keys(await zip.entries())
  return { zip, entries }
}

const newOrch = (dir: string, fixture: string) =>
  new ExportOrchestrator({
    copier: new StubBackupCopier(fixture),
    registry: STUB_REGISTRY,
    tempDir: dir,
    filesRoot: join(dir, 'files-root'),
    knowledgeRoot: join(dir, 'kb-root'),
    // StubStripper — the STUB_REGISTRY describe never runs lite (lite e2e is in
    // the real-registry describe below); a stub satisfies the required dep.
    stripper: new StubStripper()
  })

describe('ExportOrchestrator (full-preset DB-only slice)', () => {
  it('rejects a restoreId with path separators (path-traversal guard on the temp-copy path)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-'))
    try {
      const fixture = join(dir, 'fixture.db')
      await makeFixtureDb(fixture)
      const orch = newOrch(dir, fixture)

      // Act + Assert — a malicious '../escape' restoreId must NOT escape the temp
      // dir (it's joined into the temp-copy path → would let the copier overwrite
      // an arbitrary file). Each traversal variant rejects.
      for (const malicious of ['../escape', '..\\escape', 'a/b', '.', '..', 'a\0b']) {
        await expect(
          orch.exportBackup({
            preset: 'full',
            outputPath: join(dir, 'out.cbu'),
            restoreId: malicious,
            producerAppVersion: '1.0.0',
            schemaMigrationId: '0001_x.sql'
          })
        ).rejects.toThrow(/restoreId must be a safe basename/)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('exportBackup(full) produces a .cbu with manifest.json + backup.sqlite, all 14 domains, no files/', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-'))
    try {
      const fixture = join(dir, 'fixture.db')
      await makeFixtureDb(fixture)
      const out = join(dir, 'full.cbu')
      const orch = newOrch(dir, fixture)

      // Act
      const { manifest } = await orch.exportBackup({
        preset: 'full',
        outputPath: out,
        restoreId: 'r2',
        producerAppVersion: '1.0.0',
        schemaMigrationId: '0001_x.sql'
      })

      // Assert — manifest reflects the full preset
      expect(manifest.preset).toBe('full')
      expect(manifest.backupFormatVersion).toBe(1)
      expect(manifest.domains).toHaveLength(14)
      expect(new Set(manifest.domains)).toEqual(new Set(BACKUP_DOMAINS))
      expect(manifest.schemaMigrationId).toBe('0001_x.sql')
      // DB-only slice — blobs land with contributor export hooks
      expect(manifest.includeFiles).toBe(false)

      // Assert — archive layout: manifest.json + backup.sqlite, no files/ or knowledge/
      const { zip, entries } = await openZip(out)
      try {
        expect(entries).toContain('manifest.json')
        expect(entries).toContain('backup.sqlite')
        expect(entries.some((e) => e.startsWith('files/'))).toBe(false)
        expect(entries.some((e) => e.startsWith('knowledge/'))).toBe(false)

        // manifest.json inside the archive matches the returned manifest
        const m = JSON.parse((await zip.entryData('manifest.json')).toString())
        expect(m).toEqual(manifest)

        // backup.sqlite inside the archive carries the fixture data
        const extracted = join(dir, 'extracted.db')
        await zip.extract('backup.sqlite', extracted)
        const d = new Database(extracted, { readonly: true })
        try {
          const count = d.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }
          expect(count.c).toBe(2)
        } finally {
          d.close()
        }
      } finally {
        await zip.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('cleans up the temp DB copy after a successful archive', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-'))
    try {
      const fixture = join(dir, 'fixture.db')
      await makeFixtureDb(fixture)
      const out = join(dir, 'cleanup.cbu')
      const tempCopyPath = join(dir, 'r3.sqlite')
      const orch = newOrch(dir, fixture)

      await orch.exportBackup({
        preset: 'full',
        outputPath: out,
        restoreId: 'r3',
        producerAppVersion: '1.0.0',
        schemaMigrationId: '0001_x.sql'
      })

      // The temp copy must be removed once the archive is written
      expect(existsSync(tempCopyPath)).toBe(false)
      expect(existsSync(out)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('cleans up the temp copy even if archiving fails (write-stream error → reject, not hang)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-'))
    try {
      const fixture = join(dir, 'fixture.db')
      await makeFixtureDb(fixture)
      const tempCopyPath = join(dir, 'r4.sqlite')
      // An outputPath whose PARENT DIRECTORY does not exist — createWriteStream
      // emits 'error' (ENOENT) on open; without `output.on('error', reject)` the
      // archive promise would hang. This test exercises that path AND confirms the
      // temp copy is cleaned up despite the failure.
      const badOutput = join(dir, 'nonexistent-subdir', 'out.cbu')
      const orch = newOrch(dir, fixture)

      await expect(
        orch.exportBackup({
          preset: 'full',
          outputPath: badOutput,
          restoreId: 'r4',
          producerAppVersion: '1.0.0',
          schemaMigrationId: '0001_x.sql'
        })
      ).rejects.toThrow()
      expect(existsSync(tempCopyPath)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// E2e: real contributor registry (collectFileResources runs the actual hooks) +
// real SqliteFileStager + fixture blobs on disk → archive holds files/ + knowledge/.
describe('ExportOrchestrator e2e (full export with file + knowledge blobs)', () => {
  const dbh = setupTestDatabase()

  it('collects + stages file_entry blobs and knowledge base dirs into the archive', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-e2e-'))
    try {
      // Seed the live DB: 1 internal file + 1 knowledge base + app_state (ALWAYS_STRIP).
      await dbh.db.insert(fileEntryTable).values([{ id: 'f1', origin: 'internal', name: 'a', ext: 'txt', size: 5 }])
      await dbh.db
        .insert(knowledgeBaseTable)
        .values([{ id: 'kb1', name: 'kb', status: 'completed', chunkSize: 100, chunkOverlap: 20, searchMode: 'bm25' }])
      await dbh.db.insert(appStateTable).values([{ key: 'migration_v2_status', value: 'completed' }])
      // Fixture blobs at the live filesystem roots.
      const filesRoot = await mkdtemp(join(tmpdir(), 'cs-files-root-'))
      const kbRoot = await mkdtemp(join(tmpdir(), 'cs-kb-root-'))
      await writeFile(join(filesRoot, 'f1.txt'), 'hello')
      await mkdir(join(kbRoot, 'kb1'), { recursive: true })
      await writeFile(join(kbRoot, 'kb1', 'source.md'), 'doc')

      // Snapshot the live test DB (holds the seeded file_entry + knowledge_base) via
      // SqliteBackupCopier; the orchestrator then opens its own read-only handle on
      // the snapshot so collect + stage agree with backup.sqlite.
      const liveRow = dbh.sqlite.prepare('PRAGMA database_list').get() as { file: string }
      const orch = new ExportOrchestrator({
        copier: new SqliteBackupCopier(liveRow.file),
        // Real registry: collectFileResources runs the actual contributor hooks
        // (FILE_STORAGE → f1, KNOWLEDGE → kb1, PAINTINGS → none) against the snapshot.
        registry: contributorManager.getRegistry(),
        tempDir: dir,
        filesRoot,
        knowledgeRoot: kbRoot,
        // Full preset strips ALWAYS_STRIP tables (app_state / job) via step 2.5.
        stripper: new SqliteBackupStripper()
      })
      const out = join(dir, 'full.cbu')
      const { manifest } = await orch.exportBackup({
        preset: 'full',
        outputPath: out,
        restoreId: 'r1',
        producerAppVersion: '1.0.0',
        schemaMigrationId: '0001_x.sql'
      })

      // manifest reflects the staged blobs.
      expect(manifest.includeFiles).toBe(true)
      expect(manifest.includeKnowledgeFiles).toBe(true)
      expect(manifest.files.total).toBe(1)
      expect(manifest.files.totalBytes).toBe(5)
      expect(manifest.knowledge.bases).toEqual(['kb1'])

      // archive holds the staged blobs.
      const { zip, entries } = await openZip(out)
      try {
        expect(entries).toContain('files/f1')
        expect(entries).toContain('knowledge/kb1/source.md')

        // backup.sqlite: ALWAYS_STRIP tables (app_state / job) are stripped on full
        // too (step 2.5 runs every preset), while included business rows survive.
        const extracted = join(dir, 'extracted.db')
        await zip.extract('backup.sqlite', extracted)
        const d = new Database(extracted, { readonly: true })
        try {
          const count = (t: string) => (d.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c
          expect(count('app_state'), 'app_state stripped on full (ALWAYS_STRIP)').toBe(0)
          expect(count('job'), 'job stripped on full (ALWAYS_STRIP)').toBe(0)
          expect(count('file_entry'), 'file_entry preserved on full').toBe(1)
          expect(count('knowledge_base'), 'knowledge_base preserved on full').toBe(1)
        } finally {
          d.close()
        }
      } finally {
        await zip.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('lite preset strips excluded-domain rows + cascade-prunes junction referrers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-lite-'))
    try {
      // Seed: included anchors + excluded-domain rows + the 2 cross-domain junction
      // referrers (chat_message_file_ref→file_entry, assistant_knowledge_base→knowledge_base).
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
        customParameters: []
      }
      await dbh.db.insert(topicTable).values([{ id: 'tpc1', name: 'T', isNameManuallyEdited: false, orderKey: 'a' }])
      await dbh.db
        .insert(messageTable)
        .values([{ id: 'msg1', topicId: 'tpc1', role: 'root', parentId: null, data: { parts: [] }, searchableText: '', status: 'success', siblingsGroupId: 0 }])
      await dbh.db.insert(assistantTable).values([{ id: 'ast1', name: 'A', prompt: '', emoji: '🤖', description: '', settings: ASSISTANT_SETTINGS, orderKey: 'a' }])
      await dbh.db.insert(fileEntryTable).values([{ id: 'f1', origin: 'internal', name: 'test', ext: 'txt', size: 5 }])
      await dbh.db.insert(chatMessageFileRefTable).values([{ id: 'cmfr1', fileEntryId: 'f1', sourceId: 'msg1', role: 'attachment' }])
      await dbh.db
        .insert(knowledgeBaseTable)
        .values([{ id: 'kb1', name: 'KB', status: 'completed', chunkSize: 500, chunkOverlap: 50, searchMode: 'bm25' }])
      await dbh.db.insert(assistantKnowledgeBaseTable).values([{ assistantId: 'ast1', knowledgeBaseId: 'kb1' }])
      // app_state (ALWAYS_STRIP) — runtime state, must be stripped even on lite.
      await dbh.db.insert(appStateTable).values([{ key: 'migration_v2_status', value: 'completed' }])

      const liveRow = dbh.sqlite.prepare('PRAGMA database_list').get() as { file: string }
      const orch = new ExportOrchestrator({
        copier: new SqliteBackupCopier(liveRow.file),
        registry: contributorManager.getRegistry(),
        tempDir: dir,
        filesRoot: join(dir, 'files-root'),
        knowledgeRoot: join(dir, 'kb-root'),
        // Real stripper — runs step 2.5 against the copy.
        stripper: new SqliteBackupStripper()
      })
      const out = join(dir, 'lite.cbu')
      const { manifest } = await orch.exportBackup({
        preset: 'lite',
        outputPath: out,
        restoreId: 'rl',
        producerAppVersion: '1.0.0',
        schemaMigrationId: '0001_x.sql'
      })

      // manifest: 10 domains (excludes KNOWLEDGE / PAINTINGS / FILE_STORAGE / TRANSLATE_HISTORY), no blobs.
      expect(manifest.preset).toBe('lite')
      expect(manifest.domains).toHaveLength(10)
      expect(new Set(manifest.domains)).toEqual(
        new Set(BACKUP_DOMAINS.filter((d) => !['KNOWLEDGE', 'PAINTINGS', 'FILE_STORAGE', 'TRANSLATE_HISTORY'].includes(d)))
      )
      expect(manifest.includeFiles).toBe(false)
      expect(manifest.includeKnowledgeFiles).toBe(false)

      // archive: only manifest.json + backup.sqlite; no files/ or knowledge/.
      const { zip, entries } = await openZip(out)
      try {
        expect(entries).toContain('manifest.json')
        expect(entries).toContain('backup.sqlite')
        expect(entries.some((e) => e.startsWith('files/'))).toBe(false)
        expect(entries.some((e) => e.startsWith('knowledge/'))).toBe(false)

        // backup.sqlite: excluded tables empty, junction referrers cascade-pruned,
        // included rows preserved.
        const extracted = join(dir, 'extracted.db')
        await zip.extract('backup.sqlite', extracted)
        const d = new Database(extracted, { readonly: true })
        try {
          const count = (t: string) => (d.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c
          for (const t of ['file_entry', 'knowledge_base', 'knowledge_item', 'painting', 'painting_file_ref', 'translate_language', 'translate_history']) {
            expect(count(t), `${t} should be empty`).toBe(0)
          }
          // cross-domain junction referrers cascade-pruned (schema CASCADE under foreign_keys=ON)
          expect(count('chat_message_file_ref')).toBe(0)
          expect(count('assistant_knowledge_base')).toBe(0)
          // ALWAYS_STRIP tables stripped on every preset (incl. lite): app_state
          // (seeded above) + job (present in schema, 0 rows) → both empty.
          expect(count('app_state'), 'app_state stripped (ALWAYS_STRIP)').toBe(0)
          expect(count('job'), 'job stripped (ALWAYS_STRIP)').toBe(0)
          // included aggregate roots + members preserved
          expect(count('topic')).toBe(1)
          expect(count('message')).toBe(1)
          expect(count('assistant')).toBe(1)
        } finally {
          d.close()
        }
      } finally {
        await zip.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
