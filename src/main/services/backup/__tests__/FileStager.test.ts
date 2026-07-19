// Unit tests for SqliteFileStager — blob staging from live DB + filesystem roots.
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BackupReadonlyDb } from '@main/data/db/backup/contexts'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { SqliteFileStager } from '../FileStager'

/** Path-based FileManager stand-in for staging tests (copyContentTo + getMetadata). */
function pathFileBlobs(lookup: Record<string, string>) {
  return {
    async copyContentTo(id: string, destPath: string): Promise<{ size: number }> {
      const src = lookup[id]
      if (!src) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
      await copyFile(src, destPath)
      const s = await stat(destPath)
      return { size: s.size }
    },
    async getMetadata(id: string): Promise<{ size: number }> {
      const src = lookup[id]
      if (!src) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
      const s = await stat(src)
      return { size: s.size }
    }
  }
}

describe('SqliteFileStager', () => {
  const dbh = setupTestDatabase()

  it('stageFiles copies internal blobs via fileBlobs and sums sizes', async () => {
    const filesRoot = await mkdtemp(join(tmpdir(), 'cs-stager-files-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await dbh.db.insert(fileEntryTable).values([
        { id: 'f1', origin: 'internal', name: 'a', ext: 'txt', size: 5 },
        { id: 'f2', origin: 'internal', name: 'b', ext: 'md', size: 3 }
      ])
      await writeFile(join(filesRoot, 'f1.txt'), 'hello')
      await writeFile(join(filesRoot, 'f2.md'), 'doc')

      const stager = new SqliteFileStager(
        new BackupReadonlyDb(dbh.db),
        pathFileBlobs({
          f1: join(filesRoot, 'f1.txt'),
          f2: join(filesRoot, 'f2.md')
        }),
        '/unused',
        '/unused'
      )
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
      await dbh.db.insert(fileEntryTable).values([
        { id: 'f1', origin: 'internal', name: 'a', ext: 'txt', size: 5 },
        { id: 'f2', origin: 'internal', name: 'b', ext: 'md', size: 3 },
        { id: 'f4', origin: 'internal', name: 'd', ext: 'log', size: 1, deletedAt: Date.now() }
      ])
      await writeFile(join(filesRoot, 'f1.txt'), 'hello')

      const stager = new SqliteFileStager(
        new BackupReadonlyDb(dbh.db),
        pathFileBlobs({
          f1: join(filesRoot, 'f1.txt')
          // f2 deliberately absent from lookup → ENOENT → missing
        }),
        '/unused',
        '/unused'
      )
      const r = await stager.stageFiles(new Set(['f1', 'f2', 'f3', 'f4']), dest)

      expect(r.total).toBe(1)
      expect(r.totalBytes).toBe(5)
      expect([...r.missing].sort()).toEqual(['f2', 'f3', 'f4'])
    } finally {
      await rm(filesRoot, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageFiles skips external rows (dangling by design — schema ref only, no blob copy)', async () => {
    const externalDir = await mkdtemp(join(tmpdir(), 'cs-ext-'))
    const externalFile = join(externalDir, 'ext.bin')
    const intBlob = join(externalDir, 'int1.txt')
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await writeFile(externalFile, 'ext-content')
      await writeFile(intBlob, 'hello')
      await dbh.db.insert(fileEntryTable).values([
        { id: 'int1', origin: 'internal', name: 'a', ext: 'txt', size: 5 },
        { id: 'ext1', origin: 'external', name: 'e', externalPath: externalFile }
      ])

      const stager = new SqliteFileStager(
        new BackupReadonlyDb(dbh.db),
        pathFileBlobs({ int1: intBlob, ext1: externalFile }),
        '/unused',
        '/unused'
      )
      const r = await stager.stageFiles(new Set(['int1', 'ext1']), dest)

      expect(r.total).toBe(1)
      expect(r.totalBytes).toBe(5)
      expect(r.missing).toEqual(['ext1'])
      expect(existsSync(join(dest, 'int1'))).toBe(true)
      expect(existsSync(join(dest, 'ext1'))).toBe(false)
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

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), pathFileBlobs({}), kbRoot, '/unused')
      const r = await stager.stageKnowledge(new Set(['kb1', 'kb2']), dest)

      expect(r.bases).toEqual(['kb1'])
      expect(r.missing).toEqual(['kb2'])
      expect(existsSync(join(dest, 'kb1', 'source.md'))).toBe(true)
    } finally {
      await rm(kbRoot, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageKnowledge excludes .cherry/index.sqlite{,-wal,-shm} but keeps raw/index.sqlite and other .cherry files', async () => {
    const kbRoot = await mkdtemp(join(tmpdir(), 'cs-stager-kb-idx-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-idx-'))
    try {
      await mkdir(join(kbRoot, 'kb1', '.cherry'), { recursive: true })
      await mkdir(join(kbRoot, 'kb1', 'raw'), { recursive: true })
      await writeFile(join(kbRoot, 'kb1', '.cherry', 'index.sqlite'), 'INDEX')
      await writeFile(join(kbRoot, 'kb1', '.cherry', 'index.sqlite-wal'), 'WAL')
      await writeFile(join(kbRoot, 'kb1', '.cherry', 'index.sqlite-shm'), 'SHM')
      await writeFile(join(kbRoot, 'kb1', '.cherry', 'keep-me.txt'), 'meta')
      await writeFile(join(kbRoot, 'kb1', 'raw', 'source.md'), 'doc')
      // User material named index.sqlite must NOT be excluded (path not under .cherry/).
      await writeFile(join(kbRoot, 'kb1', 'raw', 'index.sqlite'), 'RAW_INDEX')

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), pathFileBlobs({}), kbRoot, '/unused')
      const r = await stager.stageKnowledge(new Set(['kb1']), dest)

      expect(r.bases).toEqual(['kb1'])
      expect(existsSync(join(dest, 'kb1', 'raw', 'source.md'))).toBe(true)
      expect(existsSync(join(dest, 'kb1', 'raw', 'index.sqlite'))).toBe(true)
      expect(existsSync(join(dest, 'kb1', '.cherry', 'keep-me.txt'))).toBe(true)
      expect(existsSync(join(dest, 'kb1', '.cherry', 'index.sqlite'))).toBe(false)
      expect(existsSync(join(dest, 'kb1', '.cherry', 'index.sqlite-wal'))).toBe(false)
      expect(existsSync(join(dest, 'kb1', '.cherry', 'index.sqlite-shm'))).toBe(false)
    } finally {
      await rm(kbRoot, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageSkillDirs copies skill folders and skips missing dirs without a missing list', async () => {
    const skillsRoot = await mkdtemp(join(tmpdir(), 'cs-stager-skills-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await mkdir(join(skillsRoot, 'skill-a'), { recursive: true })
      await writeFile(join(skillsRoot, 'skill-a', 'SKILL.md'), 'x')

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), pathFileBlobs({}), '/unused', skillsRoot)
      const r = await stager.stageSkillDirs(
        [
          { folderName: 'skill-a', contentHash: 'h1' },
          { folderName: 'skill-missing', contentHash: 'h2' }
        ],
        dest
      )

      expect(r.skills).toEqual([{ folderName: 'skill-a', contentHash: 'h1' }])
      expect(existsSync(join(dest, 'skill-a', 'SKILL.md'))).toBe(true)
    } finally {
      await rm(skillsRoot, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageNotes copies relative markdown paths under notesRoot', async () => {
    const notesRoot = await mkdtemp(join(tmpdir(), 'cs-stager-notes-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await mkdir(join(notesRoot, 'sub'), { recursive: true })
      await writeFile(join(notesRoot, 'a.md'), 'a')
      await writeFile(join(notesRoot, 'sub', 'b.md'), 'b')

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), pathFileBlobs({}), '/unused', '/unused')
      const r = await stager.stageNotes(notesRoot, new Set(['a.md', 'sub/b.md', 'gone.md']), dest)

      expect([...r.paths].sort()).toEqual(['a.md', 'sub/b.md'])
      expect(r.missing).toEqual(['gone.md'])
    } finally {
      await rm(notesRoot, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageNotes skips path-escape and symlink-escape attempts as missing', async () => {
    const notesRoot = await mkdtemp(join(tmpdir(), 'cs-stager-notes-'))
    const outside = await mkdtemp(join(tmpdir(), 'cs-stager-outside-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await writeFile(join(outside, 'secret.md'), 'secret')
      await symlink(join(outside, 'secret.md'), join(notesRoot, 'link.md'))

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), pathFileBlobs({}), '/unused', '/unused')
      const r = await stager.stageNotes(notesRoot, new Set(['../x.md', 'link.md']), dest)

      expect(r.paths).toEqual([])
      expect([...r.missing].sort()).toEqual(['../x.md', 'link.md'])
    } finally {
      await rm(notesRoot, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageFiles aborts when copy fails with EACCES but source metadata is still readable', async () => {
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-eacces-'))
    try {
      await dbh.db.insert(fileEntryTable).values([{ id: 'f1', origin: 'internal', name: 'a', ext: 'txt', size: 1 }])

      const fileBlobs = {
        async copyContentTo(): Promise<{ size: number }> {
          throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
        },
        async getMetadata(): Promise<{ size: number }> {
          return { size: 1 }
        }
      }
      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), fileBlobs, '/unused', '/unused')
      await expect(stager.stageFiles(new Set(['f1']), dest)).rejects.toThrow()
    } finally {
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageKnowledge aborts on an unreadable knowledge root (EACCES), not silently missing', async () => {
    const kbRoot = await mkdtemp(join(tmpdir(), 'cs-stager-kb-eacces-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await mkdir(join(kbRoot, 'kb1'), { recursive: true })
      await chmod(kbRoot, 0o000)
      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), pathFileBlobs({}), kbRoot, '/unused')
      await expect(stager.stageKnowledge(new Set(['kb1']), dest)).rejects.toThrow()
    } finally {
      await chmod(kbRoot, 0o755).catch(() => {})
      await rm(kbRoot, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageFiles returns empty result for an empty id set', async () => {
    const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), pathFileBlobs({}), '/unused', '/unused')
    expect(await stager.stageFiles(new Set(), '/whatever')).toEqual({ total: 0, totalBytes: 0, missing: [] })
  })
})
