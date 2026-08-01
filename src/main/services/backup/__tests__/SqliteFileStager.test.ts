// Unit tests for SqliteFileStager — blob staging from snapshot DB + filesystem roots.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { application } from '@application'
import { BackupReadonlyDb } from '@main/data/db/backup/contexts'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { SqliteFileStager } from '../SqliteFileStager'

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

beforeEach(async () => {
  await rm(internalFilesRoot, { recursive: true, force: true })
  await mkdir(internalFilesRoot, { recursive: true })
})

async function writeInternalBlob(id: string, ext: string, content: string): Promise<void> {
  const blobPath = application.getPath('feature.files.data', `${id}.${ext}`)
  await mkdir(dirname(blobPath), { recursive: true })
  await writeFile(blobPath, content)
}

const hashSkillContent = (content: string): string => createHash('sha256').update(content).digest('hex')

describe('SqliteFileStager', () => {
  const dbh = setupTestDatabase()

  it('stageFiles copies internal blobs via snapshot row path resolution and sums sizes', async () => {
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await dbh.db.insert(fileEntryTable).values([
        { id: 'f1', origin: 'internal', name: 'a', ext: 'txt', size: 5 },
        { id: 'f2', origin: 'internal', name: 'b', ext: 'md', size: 3 }
      ])
      await writeInternalBlob('f1', 'txt', 'hello')
      await writeInternalBlob('f2', 'md', 'doc')

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', '/unused')
      const r = await stager.stageFiles(new Set(['f1', 'f2']), dest)

      expect(r.total).toBe(2)
      expect(r.totalBytes).toBe(8)
      expect(r.missing).toEqual([])
      expect((await readFile(join(dest, 'f1'))).toString()).toBe('hello')
    } finally {
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageFiles reports missing for soft-deleted rows, absent rows, and absent source files', async () => {
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await dbh.db.insert(fileEntryTable).values([
        { id: 'f1', origin: 'internal', name: 'a', ext: 'txt', size: 5 },
        { id: 'f2', origin: 'internal', name: 'b', ext: 'md', size: 3 },
        { id: 'f4', origin: 'internal', name: 'd', ext: 'log', size: 1, deletedAt: Date.now() }
      ])
      await writeInternalBlob('f1', 'txt', 'hello')

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', '/unused')
      const r = await stager.stageFiles(new Set(['f1', 'f2', 'f3', 'f4']), dest)

      expect(r.total).toBe(1)
      expect(r.totalBytes).toBe(5)
      expect([...r.missing].sort()).toEqual(['f2', 'f3', 'f4'])
    } finally {
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageFiles skips external rows (dangling by design — schema ref only, no blob copy)', async () => {
    const externalDir = await mkdtemp(join(tmpdir(), 'cs-ext-'))
    const externalFile = join(externalDir, 'ext.bin')
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await writeFile(externalFile, 'ext-content')
      await writeInternalBlob('int1', 'txt', 'hello')
      await dbh.db.insert(fileEntryTable).values([
        { id: 'int1', origin: 'internal', name: 'a', ext: 'txt', size: 5 },
        { id: 'ext1', origin: 'external', name: 'e', externalPath: externalFile }
      ])

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', '/unused')
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

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), kbRoot, '/unused')
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

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), kbRoot, '/unused')
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

  it('stageSkillDirs copies skill folders and reports absent ones as missing (degradation, not prune)', async () => {
    const skillsRoot = await mkdtemp(join(tmpdir(), 'cs-stager-skills-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await mkdir(join(skillsRoot, 'skill-a'), { recursive: true })
      await writeFile(join(skillsRoot, 'skill-a', 'SKILL.md'), 'x')

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', skillsRoot)
      const r = await stager.stageSkillDirs(
        [
          { folderName: 'skill-a', contentHash: hashSkillContent('x') },
          { folderName: 'skill-missing', contentHash: 'h2' }
        ],
        dest
      )

      expect(r.skills).toEqual([{ folderName: 'skill-a', contentHash: hashSkillContent('x') }])
      // Absent dirs surface so the export can record the degradation instead of shipping a
      // registered Skill whose non-re-downloadable content the archive never carried.
      expect(r.missing).toEqual([{ folderName: 'skill-missing', contentHash: 'h2' }])
      expect(existsSync(join(dest, 'skill-a', 'SKILL.md'))).toBe(true)
    } finally {
      await rm(skillsRoot, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageSkillDirs reports a copied skill with mismatched content hash as missing degradation', async () => {
    const skillsRoot = await mkdtemp(join(tmpdir(), 'cs-stager-skills-hash-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await mkdir(join(skillsRoot, 'skill-tampered'), { recursive: true })
      await writeFile(join(skillsRoot, 'skill-tampered', 'SKILL.md'), 'actual-content')

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', skillsRoot)
      const r = await stager.stageSkillDirs(
        [{ folderName: 'skill-tampered', contentHash: hashSkillContent('expected-content') }],
        dest
      )

      expect(r.skills).toEqual([])
      expect(r.missing).toEqual([{ folderName: 'skill-tampered', contentHash: hashSkillContent('expected-content') }])
      expect(existsSync(join(dest, 'skill-tampered'))).toBe(false)
    } finally {
      await rm(skillsRoot, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageSkillDirs reports a copied skill without SKILL.md as missing degradation', async () => {
    const skillsRoot = await mkdtemp(join(tmpdir(), 'cs-stager-skills-no-md-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await mkdir(join(skillsRoot, 'skill-incomplete'), { recursive: true })
      await writeFile(join(skillsRoot, 'skill-incomplete', 'README.md'), 'not a skill descriptor')

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', skillsRoot)
      const r = await stager.stageSkillDirs([{ folderName: 'skill-incomplete', contentHash: 'expected' }], dest)

      expect(r.skills).toEqual([])
      expect(r.missing).toEqual([{ folderName: 'skill-incomplete', contentHash: 'expected' }])
      expect(existsSync(join(dest, 'skill-incomplete'))).toBe(false)
    } finally {
      await rm(skillsRoot, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageKnowledge reports a symlinked base outside knowledgeRoot as missing', async () => {
    const kbRoot = await mkdtemp(join(tmpdir(), 'cs-stager-kb-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'cs-stager-kb-outside-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await writeFile(join(outside, 'secret.md'), 'secret')
      await symlink(outside, join(kbRoot, 'kb-escape'))

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), kbRoot, '/unused')
      const r = await stager.stageKnowledge(new Set(['kb-escape']), dest)

      expect(r.bases).toEqual([])
      expect(r.missing).toEqual(['kb-escape'])
      expect(existsSync(join(dest, 'kb-escape'))).toBe(false)
    } finally {
      await rm(kbRoot, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageKnowledge rejects a baseId containing parent traversal as missing', async () => {
    const kbRoot = await mkdtemp(join(tmpdir(), 'cs-stager-kb-traversal-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), kbRoot, '/unused')
      const r = await stager.stageKnowledge(new Set(['../outside']), dest)

      expect(r.bases).toEqual([])
      expect(r.missing).toEqual(['../outside'])
    } finally {
      await rm(kbRoot, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageSkillDirs reports a symlinked skill outside skillsRoot as missing degradation', async () => {
    const skillsRoot = await mkdtemp(join(tmpdir(), 'cs-stager-skills-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'cs-stager-skills-outside-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await writeFile(join(outside, 'SKILL.md'), 'secret')
      await symlink(outside, join(skillsRoot, 'skill-escape'))

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', skillsRoot)
      const r = await stager.stageSkillDirs([{ folderName: 'skill-escape', contentHash: 'h1' }], dest)

      expect(r.skills).toEqual([])
      expect(r.missing).toEqual([{ folderName: 'skill-escape', contentHash: 'h1' }])
      expect(existsSync(join(dest, 'skill-escape'))).toBe(false)
    } finally {
      await rm(skillsRoot, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageSkillDirs rejects a folderName containing parent traversal as missing degradation', async () => {
    const skillsRoot = await mkdtemp(join(tmpdir(), 'cs-stager-skills-traversal-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', skillsRoot)
      const r = await stager.stageSkillDirs([{ folderName: '../outside', contentHash: 'h1' }], dest)

      expect(r.skills).toEqual([])
      expect(r.missing).toEqual([{ folderName: '../outside', contentHash: 'h1' }])
    } finally {
      await rm(skillsRoot, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageFiles reports a symlinked blob outside internal storage as missing', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'cs-stager-files-outside-'))
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await dbh.db
        .insert(fileEntryTable)
        .values([{ id: 'f-escape', origin: 'internal', name: 'a', ext: 'txt', size: 6 }])
      await writeFile(join(outside, 'secret.txt'), 'secret')
      await symlink(join(outside, 'secret.txt'), application.getPath('feature.files.data', 'f-escape.txt'))

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', '/unused')
      const r = await stager.stageFiles(new Set(['f-escape']), dest)

      expect(r.total).toBe(0)
      expect(r.totalBytes).toBe(0)
      expect(r.missing).toEqual(['f-escape'])
      expect(existsSync(join(dest, 'f-escape'))).toBe(false)
    } finally {
      await rm(outside, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageFiles rejects an id containing parent traversal as missing', async () => {
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-dest-'))
    try {
      await dbh.db
        .insert(fileEntryTable)
        .values([{ id: '../outside', origin: 'internal', name: 'a', ext: 'txt', size: 1 }])

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', '/unused')
      const r = await stager.stageFiles(new Set(['../outside']), dest)

      expect(r.total).toBe(0)
      expect(r.totalBytes).toBe(0)
      expect(r.missing).toEqual(['../outside'])
    } finally {
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

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', '/unused')
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

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', '/unused')
      const r = await stager.stageNotes(notesRoot, new Set(['../x.md', 'link.md']), dest)

      expect(r.paths).toEqual([])
      expect([...r.missing].sort()).toEqual(['../x.md', 'link.md'])
    } finally {
      await rm(notesRoot, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageFiles aborts when copy fails with EACCES but source is still present on disk', async () => {
    const dest = await mkdtemp(join(tmpdir(), 'cs-stager-eacces-'))
    try {
      await dbh.db.insert(fileEntryTable).values([{ id: 'f1', origin: 'internal', name: 'a', ext: 'txt', size: 1 }])
      await writeInternalBlob('f1', 'txt', 'x')
      const src = application.getPath('feature.files.data', 'f1.txt')
      await chmod(src, 0o000)

      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', '/unused')
      try {
        await expect(stager.stageFiles(new Set(['f1']), dest)).rejects.toThrow()
      } finally {
        await chmod(src, 0o755).catch(() => {})
      }
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
      const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), kbRoot, '/unused')
      await expect(stager.stageKnowledge(new Set(['kb1']), dest)).rejects.toThrow()
    } finally {
      await chmod(kbRoot, 0o755).catch(() => {})
      await rm(kbRoot, { recursive: true, force: true })
      await rm(dest, { recursive: true, force: true })
    }
  })

  it('stageFiles returns empty result for an empty id set', async () => {
    const stager = new SqliteFileStager(new BackupReadonlyDb(dbh.db), '/unused', '/unused')
    expect(await stager.stageFiles(new Set(), '/whatever')).toEqual({ total: 0, totalBytes: 0, missing: [] })
  })
})
