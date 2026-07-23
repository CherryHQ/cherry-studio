// Unit tests for ExportOrchestrator — .cherrybackup production (full-preset, DB + blob slice).
import { copyFileSync, existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { application } from '@application'
import { snapshotTo } from '@data/db/restore/snapshot'
import type { ReadonlyBackupRegistry } from '@main/data/db/backup/contributorTypes'
import { BACKUP_DOMAINS } from '@main/data/db/backup/domains'
import { appStateTable } from '@main/data/db/schemas/appState'
import { assistantTable } from '@main/data/db/schemas/assistant'
import { assistantKnowledgeBaseTable } from '@main/data/db/schemas/assistantRelations'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { chatMessageFileRefTable } from '@main/data/db/schemas/fileRelations'
import { knowledgeBaseTable } from '@main/data/db/schemas/knowledge'
import { messageTable } from '@main/data/db/schemas/message'
import { topicTable } from '@main/data/db/schemas/topic'
import type { BackupProgressUpdate } from '@shared/types/backup'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import StreamZip from 'node-stream-zip'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { contributorManager } from '../contributors/ContributorManager'
import { SqliteBackupStripper } from '../ExcludedDomainStripper'
import { ExportOrchestrator } from '../ExportOrchestrator'

/**
 * Minimal registry stub — the orchestrator's first slice only calls `topoSort`.
 * Real registry integration (real topoSort by reference deps) is covered by the
 * finalize/registry tests; this stub isolates the export pipeline.
 */
const STUB_REGISTRY = {
  // topoSort + getOperations(→ undefined) + getSchema(→ no rowScopes) only; isolates
  // the export pipeline from the real registry. getOperations returns undefined so
  // collectFileResources is skipped (no blobs); getSchema returns no rowScopes so
  // applyRowScopes (step 2.6) is a no-op. The e2e describe below uses the real registry.
  topoSort: (domains: readonly string[]) => [...domains],
  getOperations: () => undefined,
  getSchema: () => ({ tables: [], rowScopes: undefined })
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

async function writeInternalBlob(id: string, ext: string, content: string): Promise<void> {
  const blobPath = application.getPath('feature.files.data', `${id}.${ext}`)
  await mkdir(dirname(blobPath), { recursive: true })
  await writeFile(blobPath, content)
}

const newOrch = (dir: string, fixture: string) =>
  new ExportOrchestrator({
    dbService: { createSnapshot: (destPath) => copyFileSync(fixture, destPath) },
    registry: STUB_REGISTRY,
    tempDir: dir,
    knowledgeRoot: join(dir, 'kb-root'),
    skillsRoot: join(dir, 'skills-root'),
    notesRoot: () => join(dir, 'notes-root'),
    // The STUB_REGISTRY describe never runs lite (lite e2e is below), so stripping
    // is irrelevant to these isolated pipeline tests.
    stripper: { strip: async () => [] }
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
            outputPath: join(dir, 'out.cherrybackup'),
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

  it('exportBackup(full) produces a .cherrybackup with manifest.json + backup.sqlite, all 14 domains, no files/', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-'))
    try {
      const fixture = join(dir, 'fixture.db')
      await makeFixtureDb(fixture)
      const out = join(dir, 'full.cherrybackup')
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
      const out = join(dir, 'cleanup.cherrybackup')
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
      const badOutput = join(dir, 'nonexistent-subdir', 'out.cherrybackup')
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

  it('emits progress ticks across phases (snapshot → collect → archive)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-progress-'))
    try {
      const fixture = join(dir, 'fixture.db')
      await makeFixtureDb(fixture)
      const ticks: BackupProgressUpdate['phase'][] = []
      const orch = newOrch(dir, fixture)
      await orch.exportBackup({
        preset: 'full',
        outputPath: join(dir, 'out.cherrybackup'),
        restoreId: 'rp',
        producerAppVersion: '1.0.0',
        schemaMigrationId: '0001_x.sql',
        onProgress: (u) => {
          ticks.push(u.phase)
        }
      })

      // The pipeline emits at least copy (snapshot), strip/collect/stage (collect),
      // and archive (archive) — proving progress fires across phases.
      expect(ticks).toContain('snapshot')
      expect(ticks).toContain('collect')
      expect(ticks).toContain('archive')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('throws BackupCancelledError when the signal is pre-aborted + cleans up temp', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-cancel-'))
    try {
      const fixture = join(dir, 'fixture.db')
      await makeFixtureDb(fixture)
      const tempCopyPath = join(dir, 'rc.sqlite')
      const orch = newOrch(dir, fixture)
      const ac = new AbortController()
      ac.abort()

      await expect(
        orch.exportBackup({
          preset: 'full',
          outputPath: join(dir, 'out.cherrybackup'),
          restoreId: 'rc',
          producerAppVersion: '1.0.0',
          schemaMigrationId: '0001_x.sql',
          signal: ac.signal
        })
      ).rejects.toThrow(/cancelled/i)

      // Temp copy cleaned up despite cancellation (the finally block runs).
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
  let internalFilesRoot: string

  beforeAll(async () => {
    internalFilesRoot = await mkdtemp(join(tmpdir(), 'cs-internal-files-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.files.data') {
        return filename ? join(internalFilesRoot, filename) : internalFilesRoot
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
  })

  it('collects + stages file_entry blobs and knowledge base dirs into the archive', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-e2e-'))
    try {
      // Seed the live DB: 1 internal file + 1 knowledge base + app_state (ALWAYS_STRIP).
      await dbh.db.insert(fileEntryTable).values([{ id: 'f1', origin: 'internal', name: 'a', ext: 'txt', size: 5 }])
      await dbh.db
        .insert(knowledgeBaseTable)
        .values([{ id: 'kb1', name: 'kb', status: 'completed', chunkSize: 100, chunkOverlap: 20 }])
      await dbh.db.insert(appStateTable).values([{ key: 'migration_v2_status', value: 'completed' }])
      // Fixture blobs at the live filesystem roots.
      const kbRoot = await mkdtemp(join(tmpdir(), 'cs-kb-root-'))
      const notesRoot = await mkdtemp(join(tmpdir(), 'cs-notes-root-'))
      await writeInternalBlob('f1', 'txt', 'hello')
      await mkdir(join(kbRoot, 'kb1'), { recursive: true })
      await mkdir(join(kbRoot, 'kb1', '.cherry'), { recursive: true })
      await mkdir(join(kbRoot, 'kb1', 'raw'), { recursive: true })
      await writeFile(join(kbRoot, 'kb1', 'source.md'), 'doc')
      await writeFile(join(kbRoot, 'kb1', 'raw', 'kept.md'), 'raw-body')
      await writeFile(join(kbRoot, 'kb1', '.cherry', 'index.sqlite'), 'INDEX')
      await writeFile(join(kbRoot, 'kb1', '.cherry', 'index.sqlite-wal'), 'WAL')
      await writeFile(join(kbRoot, 'kb1', '.cherry', 'index.sqlite-shm'), 'SHM')
      // Seed Notes markdown bodies (PREFERENCES file resource) — one at root, one
      // nested, one with an uppercase .MD ext — to exercise recursive collect,
      // sub-dir-preserving stage, and case-insensitive ext matching (Notes UI treats
      // .MD == .md, so the collector must too or uppercase-ext notes silently drop).
      await writeFile(join(notesRoot, 'note1.md'), '# note 1')
      await mkdir(join(notesRoot, 'sub'), { recursive: true })
      await writeFile(join(notesRoot, 'sub', 'note2.md'), '# note 2')
      await writeFile(join(notesRoot, 'note3.MD'), '# note 3')

      // Snapshot the live test DB (holds the seeded file_entry + knowledge_base) via
      // DbService.createSnapshot; the orchestrator then opens its own read-only handle on
      // the snapshot so collect + stage agree with backup.sqlite.
      const orch = new ExportOrchestrator({
        dbService: {
          createSnapshot: (destPath) => {
            snapshotTo(dbh.sqlite, destPath)
          }
        },
        // Real registry: collectFileResources runs the actual contributor hooks
        // (FILE_STORAGE → f1, KNOWLEDGE → kb1, PAINTINGS → none, PREFERENCES → notes)
        // against the snapshot.
        registry: contributorManager.getRegistry(),
        tempDir: dir,
        knowledgeRoot: kbRoot,
        skillsRoot: kbRoot,
        notesRoot: () => notesRoot,
        // Full preset strips ALWAYS_STRIP tables (app_state / job) via step 2.5.
        stripper: new SqliteBackupStripper()
      })
      const out = join(dir, 'full.cherrybackup')
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
      expect(manifest.files.ids).toEqual(['f1'])
      expect(manifest.files.total).toBe(1)
      expect(manifest.files.totalBytes).toBe(5)
      expect(manifest.knowledge.bases).toEqual(['kb1'])
      // notes: all seeded markdown bodies staged (POSIX relpaths, sub-dir preserved,
      // uppercase .MD included — case-insensitive ext match).
      expect(new Set(manifest.notes.paths)).toEqual(new Set(['note1.md', 'sub/note2.md', 'note3.MD']))

      // archive holds the staged blobs.
      const { zip, entries } = await openZip(out)
      try {
        expect(entries).toContain('files/f1')
        expect(entries).toContain('knowledge/kb1/source.md')
        expect(entries).toContain('knowledge/kb1/raw/kept.md')
        // R1: derived vector index (+ WAL sidecars) must not enter the archive.
        expect(entries.some((e) => e.includes('index.sqlite'))).toBe(false)
        expect(entries).toContain('notes/note1.md')
        expect(entries).toContain('notes/sub/note2.md')

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

  it('prunes file_entry/knowledge_base rows whose blob/dir was missing at stage (DB↔staged alignment)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-missing-'))
    try {
      const kbRoot = await mkdtemp(join(tmpdir(), 'cs-kb-root-'))
      // mf1 has a blob on disk; mf2 does NOT (missing). mkb1 has a dir; mkb2 does NOT.
      await writeInternalBlob('mf1', 'txt', 'hello')
      await mkdir(join(kbRoot, 'mkb1'), { recursive: true })
      await writeFile(join(kbRoot, 'mkb1', 'source.md'), 'doc')

      // Isolate from earlier tests' rows, then seed exactly these 4 fixtures.
      await dbh.db.delete(fileEntryTable)
      await dbh.db.delete(knowledgeBaseTable)
      await dbh.db.insert(fileEntryTable).values([
        { id: 'mf1', origin: 'internal', name: 'a', ext: 'txt', size: 5 },
        { id: 'mf2', origin: 'internal', name: 'b', ext: 'txt', size: 5 }
      ])
      await dbh.db.insert(knowledgeBaseTable).values([
        { id: 'mkb1', name: 'kb1', status: 'completed', chunkSize: 100, chunkOverlap: 20 },
        { id: 'mkb2', name: 'kb2', status: 'completed', chunkSize: 100, chunkOverlap: 20 }
      ])

      const orch = new ExportOrchestrator({
        dbService: {
          createSnapshot: (destPath) => {
            snapshotTo(dbh.sqlite, destPath)
          }
        },
        registry: contributorManager.getRegistry(),
        tempDir: dir,
        knowledgeRoot: kbRoot,
        skillsRoot: kbRoot,
        // No Notes root for this fixture — undefined skips notes collect (a missing
        // path string would now throw after the ENOENT harden).
        notesRoot: () => undefined,
        stripper: new SqliteBackupStripper()
      })
      const out = join(dir, 'missing.cherrybackup')
      const { manifest } = await orch.exportBackup({
        preset: 'full',
        outputPath: out,
        restoreId: 'rm',
        producerAppVersion: '1.0.0',
        schemaMigrationId: '0001_x.sql'
      })

      // manifest reflects ONLY staged (mf1, mkb1); mf2/mkb2 missing excluded.
      expect(manifest.files.ids).toEqual(['mf1'])
      expect(manifest.files.total).toBe(1)
      expect(manifest.knowledge.bases).toEqual(['mkb1'])

      // archive: only staged blobs/dir present; missing absent.
      const { zip, entries } = await openZip(out)
      try {
        expect(entries).toContain('files/mf1')
        expect(entries).not.toContain('files/mf2')
        expect(entries).toContain('knowledge/mkb1/source.md')
        expect(entries.some((e) => e.startsWith('knowledge/mkb2'))).toBe(false)

        // backup.sqlite: missing rows PRUNED — DB rows ↔ staged files 1:1, so
        // restore can't re-create a row pointing at a file the archive never held.
        const extracted = join(dir, 'extracted.db')
        await zip.extract('backup.sqlite', extracted)
        const d = new Database(extracted, { readonly: true })
        try {
          const count = (t: string) => (d.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c
          expect(count('file_entry'), 'mf2 pruned (missing blob)').toBe(1)
          expect(count('knowledge_base'), 'mkb2 pruned (missing dir)').toBe(1)
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

  it('retains external file_entry rows + their file_ref references (§5.1 dangling by design)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-ext-'))
    try {
      const kbRoot = await mkdtemp(join(tmpdir(), 'cs-kb-root-'))
      // int1 has an internal blob (staged); ext1 is external (dangling — no blob
      // copied, §5.1). msg1 references BOTH via chat_message_file_ref.
      await writeInternalBlob('int1', 'txt', 'hello')

      await dbh.db.delete(chatMessageFileRefTable)
      await dbh.db.delete(fileEntryTable)
      await dbh.db.delete(messageTable)
      await dbh.db.delete(topicTable)
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
      await dbh.db.insert(fileEntryTable).values([
        { id: 'int1', origin: 'internal', name: 'a', ext: 'txt', size: 5 },
        { id: 'ext1', origin: 'external', name: 'e', externalPath: '/Users/x/ext.bin' }
      ])
      await dbh.db.insert(chatMessageFileRefTable).values([
        { id: 'cmfr_int', fileEntryId: 'int1', sourceId: 'msg1', role: 'attachment' },
        { id: 'cmfr_ext', fileEntryId: 'ext1', sourceId: 'msg1', role: 'attachment' }
      ])

      const orch = new ExportOrchestrator({
        dbService: {
          createSnapshot: (destPath) => {
            snapshotTo(dbh.sqlite, destPath)
          }
        },
        registry: contributorManager.getRegistry(),
        tempDir: dir,
        knowledgeRoot: kbRoot,
        skillsRoot: join(dir, 'skills-root'),
        notesRoot: () => undefined,
        stripper: new SqliteBackupStripper()
      })
      const out = join(dir, 'ext.cherrybackup')
      const { manifest } = await orch.exportBackup({
        preset: 'full',
        outputPath: out,
        restoreId: 're',
        producerAppVersion: '1.0.0',
        schemaMigrationId: '0001_x.sql'
      })

      // manifest: only int1 staged (external has no blob). ext1 not in files.
      expect(manifest.files.ids).toEqual(['int1'])

      const { zip, entries } = await openZip(out)
      try {
        expect(entries).toContain('files/int1')
        expect(entries).not.toContain('files/ext1')
        const extracted = join(dir, 'extracted.db')
        await zip.extract('backup.sqlite', extracted)
        const d = new Database(extracted, { readonly: true })
        try {
          const count = (t: string) => (d.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c
          // §5.1: external file_entry is dangling by design — RETAINED (origin guard
          // in pruneMissingRows), so its file_ref reference survives into the archive
          // (the message still records it referenced /Users/x/ext.bin on restore).
          expect(count('file_entry'), 'int1 + ext1 both retained').toBe(2)
          expect(count('chat_message_file_ref'), 'both refs retained (external row not cascade-deleted)').toBe(2)
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
        enableGenerateImage: false,
        customParameters: []
      }
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
      await dbh.db.insert(assistantTable).values([
        {
          id: 'ast1',
          name: 'A',
          prompt: '',
          emoji: '🤖',
          description: '',
          settings: ASSISTANT_SETTINGS,
          orderKey: 'a'
        }
      ])
      await dbh.db.insert(fileEntryTable).values([{ id: 'f1', origin: 'internal', name: 'test', ext: 'txt', size: 5 }])
      await dbh.db
        .insert(chatMessageFileRefTable)
        .values([{ id: 'cmfr1', fileEntryId: 'f1', sourceId: 'msg1', role: 'attachment' }])
      await dbh.db
        .insert(knowledgeBaseTable)
        .values([{ id: 'kb1', name: 'KB', status: 'completed', chunkSize: 500, chunkOverlap: 50 }])
      await dbh.db.insert(assistantKnowledgeBaseTable).values([{ assistantId: 'ast1', knowledgeBaseId: 'kb1' }])
      // app_state (ALWAYS_STRIP) — runtime state, must be stripped even on lite.
      await dbh.db.insert(appStateTable).values([{ key: 'migration_v2_status', value: 'completed' }])

      // Seed a REAL Notes markdown body under the notes root. lite must NOT archive it
      // (file resources are lite-excluded; only the `note` overlay rows travel in the DB
      // copy). Guards the preset gate that skips PREFERENCES.collectFileResources in lite
      // — without the gate, this note would leak into the lite archive.
      await mkdir(join(dir, 'notes-root'), { recursive: true })
      await writeFile(join(dir, 'notes-root', 'secret.md'), '# must NOT appear in lite archive')

      // notesRoot must NOT be evaluated on lite — an unavailable custom Notes path
      // would otherwise abort an export that never stages notes.
      const orch = new ExportOrchestrator({
        dbService: {
          createSnapshot: (destPath) => {
            snapshotTo(dbh.sqlite, destPath)
          }
        },
        registry: contributorManager.getRegistry(),
        tempDir: dir,
        knowledgeRoot: join(dir, 'kb-root'),
        skillsRoot: join(dir, 'skills-root'),
        notesRoot: () => {
          throw new Error('notesRoot must not be called on lite export')
        },
        // Real stripper — runs step 2.5 against the copy.
        stripper: new SqliteBackupStripper()
      })
      const out = join(dir, 'lite.cherrybackup')
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
        new Set(
          BACKUP_DOMAINS.filter((d) => !['KNOWLEDGE', 'PAINTINGS', 'FILE_STORAGE', 'TRANSLATE_HISTORY'].includes(d))
        )
      )
      expect(manifest.includeFiles).toBe(false)
      expect(manifest.includeKnowledgeFiles).toBe(false)
      // lite excludes file resources: a REAL note is seeded above, yet the preset gate
      // skips PREFERENCES.collectFileResources → no notes staged.
      expect(manifest.notes.paths).toEqual([])

      // archive: only manifest.json + backup.sqlite; no files/ or knowledge/ or notes/.
      const { zip, entries } = await openZip(out)
      try {
        expect(entries).toContain('manifest.json')
        expect(entries).toContain('backup.sqlite')
        expect(entries.some((e) => e.startsWith('files/'))).toBe(false)
        expect(entries.some((e) => e.startsWith('knowledge/'))).toBe(false)
        expect(entries.some((e) => e.startsWith('notes/'))).toBe(false)

        // backup.sqlite: excluded tables empty, junction referrers cascade-pruned,
        // included rows preserved.
        const extracted = join(dir, 'extracted.db')
        await zip.extract('backup.sqlite', extracted)
        const d = new Database(extracted, { readonly: true })
        try {
          const count = (t: string) => (d.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c
          for (const t of [
            'file_entry',
            'knowledge_base',
            'knowledge_item',
            'painting',
            'painting_file_ref',
            'translate_language',
            'translate_history'
          ]) {
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

// rowScopes filter stub — same shape as STUB_REGISTRY but getSchema returns a rowScope
// on AGENTS so applyRowScopes prunes non-agent.task job_schedule rows (step 2.6).
const STUB_REGISTRY_WITH_ROWSCOPES = {
  topoSort: (domains: readonly string[]) => [...domains],
  getOperations: () => undefined,
  getSchema: (d: string) =>
    d === 'AGENTS'
      ? {
          tables: [],
          rowScopes: [
            {
              table: 'job_schedule',
              ownerDomain: 'AGENTS',
              filter: { column: 'type', op: 'eq', value: 'agent.task' }
            }
          ]
        }
      : { tables: [], rowScopes: undefined }
} as unknown as ReadonlyBackupRegistry

/** Fixture with a job_schedule table carrying multiple JobTypes — only agent.task is AGENTS-owned. */
const makeJobScheduleDb = async (fixturePath: string): Promise<void> => {
  const db = new Database(fixturePath)
  db.exec('CREATE TABLE job_schedule(id TEXT, type TEXT)')
  db.exec(
    `INSERT INTO job_schedule VALUES ('js1','agent.task'),('js2','file-processing.background'),('js3','knowledge.index-documents')`
  )
  db.close()
}

describe('ExportOrchestrator rowScopes filter (AGENTS job_schedule partition)', () => {
  it('keeps only job_schedule type=agent.task + drops other runtime types', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-rowscopes-'))
    try {
      const fixture = join(dir, 'fixture.db')
      await makeJobScheduleDb(fixture)
      const orch = new ExportOrchestrator({
        dbService: { createSnapshot: (destPath) => copyFileSync(fixture, destPath) },
        registry: STUB_REGISTRY_WITH_ROWSCOPES,
        tempDir: dir,
        knowledgeRoot: join(dir, 'kb-root'),
        skillsRoot: join(dir, 'skills-root'),
        notesRoot: () => join(dir, 'notes-root'),
        // Full preset has no lite exclusions; a no-op isolates the rowScopes filter.
        stripper: { strip: async () => [] }
      })
      const out = join(dir, 'rowscopes.cherrybackup')
      await orch.exportBackup({
        preset: 'full',
        outputPath: out,
        restoreId: 'rrs',
        producerAppVersion: '1.0.0',
        schemaMigrationId: '0001_x.sql'
      })

      // backup.sqlite: only the AGENTS-owned partition (type=agent.task) survives;
      // other job_schedule types are runtime state, pruned by the rowScopes filter.
      const { zip } = await openZip(out)
      try {
        const extracted = join(dir, 'extracted.db')
        await zip.extract('backup.sqlite', extracted)
        const d = new Database(extracted, { readonly: true })
        try {
          const rows = d.prepare('SELECT id, type FROM job_schedule ORDER BY id').all() as {
            id: string
            type: string
          }[]
          expect(rows).toEqual([{ id: 'js1', type: 'agent.task' }])
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

describe('ExportOrchestrator notes body ↔ collect 1:1 (fs-catch)', () => {
  it('fails export when a collected notes path is missing at stage time (no false success)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-export-notes-missing-'))
    try {
      const fixture = join(dir, 'fixture.db')
      await makeFixtureDb(fixture)
      const notesRoot = join(dir, 'notes-root')
      await mkdir(notesRoot, { recursive: true })
      const registry = {
        topoSort: (domains: readonly string[]) => [...domains],
        getOperations: () => ({
          collectFileResources: async () => [{ kind: 'notes-file' as const, relPath: 'ghost.md' }]
        }),
        getSchema: () => ({ tables: [], rowScopes: undefined })
      } as unknown as ReadonlyBackupRegistry

      const orch = new ExportOrchestrator({
        dbService: { createSnapshot: (destPath) => copyFileSync(fixture, destPath) },
        registry,
        tempDir: dir,
        knowledgeRoot: join(dir, 'kb-root'),
        skillsRoot: join(dir, 'skills-root'),
        notesRoot: () => notesRoot,
        stripper: { strip: async () => [] }
      })

      await expect(
        orch.exportBackup({
          preset: 'full',
          outputPath: join(dir, 'out.cherrybackup'),
          restoreId: 'rn',
          producerAppVersion: '1.0.0',
          schemaMigrationId: '0001_x.sql'
        })
      ).rejects.toThrow(/notes body missing after collect/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
