// Unit tests for SqliteFileStager — blob staging from live DB + filesystem roots.
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BackupReadonlyDb } from '@main/data/db/backup/contexts'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { SqliteFileStager } from './FileStager'

describe('SqliteFileStager', () => {
  const dbh = setupTestDatabase()

  it('stageFiles copies internal blobs from <filesRoot>/<id>.<ext> and sums sizes', async () => {
    const filesRoot = await mkdtemp(join(tmpdir(), 'cs-stager-files-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await dbh.db.insert(fileEntryTable).values([
        { id: 'f1', origin: 'internal', name: 'a', ext: 'txt', size: 5 },
        { id: 'f2', origin: 'internal', name: 'b', ext: 'md', size: 3 }
      ])
      await writeFile(join(filesRoot, 'f1.txt'), 'hello')
      await writeFile(join(filesRoot, 'f2.md'), 'doc')

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), filesRoot, filesRoot)
      const r = await stager.stageFiles(new Set(['f1', 'f2']), dest)

      expect(r.total).toBe(2)
      expect(r.totalBytes).toBe(8)
      expect(r.missing).toEqual([])
      expect((await readFile(join(dest, 'f1'))).toString()).toBe('hello')
    } finally {
      await rm(filesRoot, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageFiles reports missing for soft-deleted rows, absent rows, and absent source files', async () => {
    const filesRoot = await mkdtemp(join(tmpdir(), 'cs-stager-files-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      // f1: valid row + source exists → staged.
      // f2: valid row but source file missing on disk → missing.
      // f3: no file_entry row (stale ref from an un-pruned junction) → missing.
      // f4: soft-deleted row → excluded by the deletedAt filter → missing.
      await dbh.db.insert(fileEntryTable).values([
        { id: 'f1', origin: 'internal', name: 'a', ext: 'txt', size: 5 },
        { id: 'f2', origin: 'internal', name: 'b', ext: 'md', size: 3 },
        { id: 'f4', origin: 'internal', name: 'd', ext: 'log', size: 1, deletedAt: Date.now() }
      ])
      await writeFile(join(filesRoot, 'f1.txt'), 'hello')

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), filesRoot, filesRoot)
      const r = await stager.stageFiles(new Set(['f1', 'f2', 'f3', 'f4']), dest)

      expect(r.total).toBe(1)
      expect(r.totalBytes).toBe(5)
      expect([...r.missing].sort()).toEqual(['f2', 'f3', 'f4'])
    } finally {
      await rm(filesRoot, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageFiles copies external blobs from the row absolute externalPath', async () => {
    const externalDir = await mkdtemp(join(tmpdir(), 'cs-ext-'))
    const externalFile = join(externalDir, 'ext.bin')
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await writeFile(externalFile, 'ext-content')
      await dbh.db
        .insert(fileEntryTable)
        .values([{ id: 'ext1', origin: 'external', name: 'e', externalPath: externalFile }])

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', '/unused')
      const r = await stager.stageFiles(new Set(['ext1']), dest)

      expect(r.total).toBe(1)
      expect(r.totalBytes).toBe(11) // 'ext-content'.length
      expect((await readFile(join(dest, 'ext1'))).toString()).toBe('ext-content')
    } finally {
      await rm(externalDir, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageKnowledge copies <baseId>/ dirs recursively and lists staged vs missing', async () => {
    const kbRoot = await mkdtemp(join(tmpdir(), 'cs-stager-kb-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await mkdir(join(kbRoot, 'kb1', '.cherry'), { recursive: true })
      await writeFile(join(kbRoot, 'kb1', 'source.md'), 'doc')
      // kb2 dir NOT created on disk → missing.

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', kbRoot)
      const r = await stager.stageKnowledge(new Set(['kb1', 'kb2']), dest)

      expect(r.bases).toEqual(['kb1'])
      expect(r.missing).toEqual(['kb2'])
      expect(existsSync(join(dest, 'kb1', 'source.md'))).toBe(true)
    } finally {
      await rm(kbRoot, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('returns empty results for empty input sets (no IO)', async () => {
    const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', '/unused')
    expect(await stager.stageFiles(new Set(), '/whatever')).toEqual({ total: 0, totalBytes: 0, missing: [] })
    expect(await stager.stageKnowledge(new Set(), '/whatever')).toEqual({ bases: [], missing: [] })
  })
})
