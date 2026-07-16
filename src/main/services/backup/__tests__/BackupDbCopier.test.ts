// Unit tests for BackupDbCopier — db.backup() online copy consistency.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { type BackupDbCopier, SqliteBackupCopier, StubBackupCopier } from '../BackupDbCopier'

describe('SqliteBackupCopier', () => {
  it('copies a live DB to dest with all rows + integrity_check ok (source stays open)', async () => {
    // Arrange — source DB kept OPEN to mimic the live DbService connection
    const dir = await mkdtemp(join(tmpdir(), 'cs-copier-'))
    try {
      const srcPath = join(dir, 'live.db')
      const src = new Database(srcPath)
      src.pragma('journal_mode = WAL')
      src.exec('CREATE TABLE t(x INTEGER)')
      src.exec('INSERT INTO t VALUES (1), (2), (3)')

      // Act — 2nd connection backs up the live file while src stays open
      const copier: BackupDbCopier = new SqliteBackupCopier(srcPath)
      const destPath = join(dir, 'copy.db')
      await copier.copyTo(destPath)

      // Assert — dest carries the same rows + is structurally sound
      const dest = new Database(destPath, { readonly: true })
      try {
        const count = dest.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }
        expect(count.c).toBe(3)
        const ic = dest.pragma('integrity_check', { simple: true }) as string
        expect(ic).toBe('ok')
      } finally {
        dest.close()
      }
      src.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('captures a point-in-time snapshot (rows written after backup are NOT in the copy)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-copier-'))
    try {
      const srcPath = join(dir, 'live.db')
      const src = new Database(srcPath)
      src.exec('CREATE TABLE t(x INTEGER)')
      src.exec('INSERT INTO t VALUES (1), (2)')

      // Act — back up, THEN insert a 3rd row after the snapshot resolves
      const destPath = join(dir, 'copy.db')
      await new SqliteBackupCopier(srcPath).copyTo(destPath)
      src.exec('INSERT INTO t VALUES (3)')

      // Assert — the copy reflects the pre-snapshot state (2 rows)
      const dest = new Database(destPath, { readonly: true })
      try {
        const count = dest.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }
        expect(count.c).toBe(2)
      } finally {
        dest.close()
      }
      // The live DB continues to accept writes (3 rows now)
      const live = src.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number }
      expect(live.c).toBe(3)
      src.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('throws when the live DB file does not exist (fileMustExist guard)', async () => {
    // Arrange — a path with no underlying file
    const dir = await mkdtemp(join(tmpdir(), 'cs-copier-'))
    try {
      const copier: BackupDbCopier = new SqliteBackupCopier(join(dir, 'does-not-exist.db'))

      // Act + Assert — opening a 2nd connection with fileMustExist rejects
      await expect(copier.copyTo(join(dir, 'dest.db'))).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('StubBackupCopier', () => {
  it('copies the fixture file bytes to dest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-copier-'))
    try {
      const fixture = join(dir, 'fixture.db')
      await writeFile(fixture, Buffer.from('fixture-bytes'))
      const dest = join(dir, 'dest.db')

      await new StubBackupCopier(fixture).copyTo(dest)

      expect((await readFile(dest)).toString()).toBe('fixture-bytes')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
