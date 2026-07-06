// Unit tests for assembleArchive — zip layout round-trip (no DB; dummy blob bytes).
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import StreamZip from 'node-stream-zip'
import { describe, expect, it } from 'vitest'

import { assembleArchive } from './archive'
import { BACKUP_FORMAT_VERSION, type BackupManifest } from './manifest'

const MANIFEST_FULL: BackupManifest = {
  backupFormatVersion: BACKUP_FORMAT_VERSION,
  createdAt: '2026-07-04T12:00:00.000Z',
  preset: 'full',
  domains: ['PREFERENCES', 'PROVIDERS', 'FILE_STORAGE', 'KNOWLEDGE'],
  includeFiles: true,
  includeKnowledgeFiles: true,
  sensitiveData: { included: true, rotated: false },
  schemaMigrationId: '0001_abc.sql',
  producerAppVersion: '1.0.0',
  files: { ids: ['f1'], total: 1, totalBytes: 6 },
  knowledge: { bases: ['base-1'] },
  notes: { paths: [] }
}

const openZip = async (p: string) => {
  const zip = new StreamZip.async({ file: p })
  const entries = Object.keys(await zip.entries())
  return { zip, entries }
}

describe('assembleArchive', () => {
  it('full layout: manifest.json + backup.sqlite + files/<id> + knowledge/<baseId>/', async () => {
    // Arrange — temp dir with a dummy db copy, a file blob, and a knowledge folder
    const dir = await mkdtemp(join(tmpdir(), 'cs-archive-'))
    try {
      const dbCopy = join(dir, 'backup.sqlite')
      await writeFile(dbCopy, Buffer.from('sqlite-placeholder'))
      const filesDir = join(dir, 'files-staging')
      await mkdir(filesDir)
      await writeFile(join(filesDir, 'file-id-1'), Buffer.from('blob-1'))
      const knowledgeDir = join(dir, 'kb-staging')
      await mkdir(join(knowledgeDir, 'base-1'), { recursive: true })
      await writeFile(join(knowledgeDir, 'base-1', 'note.md'), Buffer.from('# note'))

      // Act
      const out = join(dir, 'archive.cbu')
      await assembleArchive(out, { manifest: MANIFEST_FULL, dbCopyPath: dbCopy, filesDir, knowledgeDir })

      // Assert — the §2 layout entries are all present
      const { zip, entries } = await openZip(out)
      try {
        expect(entries).toContain('manifest.json')
        expect(entries).toContain('backup.sqlite')
        expect(entries).toContain('files/file-id-1')
        expect(entries).toContain('knowledge/base-1/note.md')
        // manifest content round-trips through the zip
        const data = await zip.entryData('manifest.json')
        expect(JSON.parse(data.toString('utf8'))).toEqual(MANIFEST_FULL)
        // backup.sqlite bytes preserved
        const dbData = await zip.entryData('backup.sqlite')
        expect(dbData.toString('utf8')).toBe('sqlite-placeholder')
      } finally {
        await zip.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('lite layout (no filesDir / knowledgeDir): only manifest.json + backup.sqlite', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-archive-'))
    try {
      const dbCopy = join(dir, 'backup.sqlite')
      await writeFile(dbCopy, Buffer.from('x'))
      const out = join(dir, 'lite.cbu')
      await assembleArchive(out, {
        manifest: { ...MANIFEST_FULL, preset: 'lite', includeFiles: false, includeKnowledgeFiles: false },
        dbCopyPath: dbCopy
      })

      const { zip, entries } = await openZip(out)
      try {
        expect(entries).toEqual(expect.arrayContaining(['manifest.json', 'backup.sqlite']))
        expect(entries.some((e) => e.startsWith('files/'))).toBe(false)
        expect(entries.some((e) => e.startsWith('knowledge/'))).toBe(false)
        expect(entries).toHaveLength(2)
      } finally {
        await zip.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('produces a valid zip reopenable by node-stream-zip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-archive-'))
    try {
      const dbCopy = join(dir, 'backup.sqlite')
      await writeFile(dbCopy, Buffer.from('reopen-me'))
      const out = join(dir, 'a.cbu')
      await assembleArchive(out, { manifest: MANIFEST_FULL, dbCopyPath: dbCopy })

      // Assert — no throw on open; central directory is well-formed
      const { zip } = await openZip(out)
      await zip.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects when dbCopyPath is missing (pre-stat guard — no archive without backup.sqlite)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-archive-'))
    try {
      const out = join(dir, 'a.cbu')
      // Act + Assert — a missing payload rejects loudly instead of producing a
      // backup.sqlite-less .cbu (archiver would otherwise warn + succeed)
      await expect(
        assembleArchive(out, { manifest: MANIFEST_FULL, dbCopyPath: join(dir, 'missing.sqlite') })
      ).rejects.toThrow()
      expect(existsSync(out)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does NOT leave a file at outPath if the write fails (atomic temp + rename)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-archive-'))
    try {
      const dbCopy = join(dir, 'backup.sqlite')
      await writeFile(dbCopy, Buffer.from('x'))
      // outPath whose PARENT dir does not exist → createWriteStream(tmp) errors
      // (ENOENT) → reject → temp unlinked → outPath never created. Proves a write
      // failure can't leave a partial/corrupt archive at the user-visible path.
      const out = join(dir, 'nonexistent-subdir', 'a.cbu')
      await expect(
        assembleArchive(out, { manifest: MANIFEST_FULL, dbCopyPath: dbCopy })
      ).rejects.toThrow()
      expect(existsSync(out)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
