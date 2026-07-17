// Unit tests for BackupDbCopier — db.backup() online copy consistency.
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { type BackupDbCopier, SqliteBackupCopier, StubBackupCopier } from '../BackupDbCopier'

/** Test double for Pick<DbService, 'backupTo'> that backs up a managed sqlite handle. */
function managedBackupTo(sqlite: Database.Database): Pick<{ backupTo: (dest: string) => Promise<void> }, 'backupTo'> {
  return {
    async backupTo(destPath: string) {
      await unlink(destPath).catch(() => {})
      await sqlite.backup(destPath)
    }
  }
}

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

      // Act — backup via the managed connection (no second live open)
      const copier: BackupDbCopier = new SqliteBackupCopier(managedBackupTo(src))
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
      await new SqliteBackupCopier(managedBackupTo(src)).copyTo(destPath)
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

  it('propagates backupTo failures from the managed DbService', async () => {
    const copier: BackupDbCopier = new SqliteBackupCopier({
      backupTo: async () => {
        throw new Error('Database was closed for dev reset and cannot backupTo')
      }
    })
    await expect(copier.copyTo('/tmp/unused-dest.db')).rejects.toThrow(/cannot backupTo/)
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
