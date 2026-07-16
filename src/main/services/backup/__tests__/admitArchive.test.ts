import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readAppliedChain } from '@main/data/db/restore/appliedChain'
import { snapshotTo } from '@main/data/db/restore/snapshot'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { admitArchive, assertWithin } from '../admitArchive'
import { assembleArchive } from '../archive'
import { BackupArchiveCorruptError, NewerOrDivergedBackupError, UnsupportedBackupFormatError } from '../errors'
import { BACKUP_FORMAT_VERSION, type BackupManifest } from '../manifest'

const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../migrations/sqlite-drizzle')

type MigrationJournalEntry = {
  readonly idx: number
  readonly version: string
  readonly when: number
  readonly tag: string
  readonly breakpoints: boolean
}

type MigrationJournal = {
  readonly dialect: string
  readonly entries: readonly MigrationJournalEntry[]
}

const MANIFEST: BackupManifest = {
  backupFormatVersion: BACKUP_FORMAT_VERSION,
  createdAt: '2026-07-16T00:00:00.000Z',
  preset: 'full',
  domains: ['TOPICS'],
  includeFiles: true,
  includeKnowledgeFiles: true,
  sensitiveData: { included: true, rotated: false },
  schemaMigrationId: 'test',
  producerAppVersion: 'test',
  files: { ids: ['file-1'], total: 1, totalBytes: 4 },
  knowledge: { bases: ['knowledge-1'] },
  skills: { folders: [{ folderName: 'skill-1', contentHash: 'skill-hash' }] },
  notes: { paths: ['note.md'] },
  degraded: { resources: [] }
}

describe('admitArchive', () => {
  const dbh = setupTestDatabase()
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cs-admit-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function buildArchive(
    manifest: BackupManifest = MANIFEST,
    mutateSnapshot?: (sqlite: Database.Database) => void
  ): Promise<string> {
    const snapshotPath = join(tempDir, 'archive-source.sqlite')
    snapshotTo(dbh.sqlite, snapshotPath)
    if (mutateSnapshot) {
      const sqlite = new Database(snapshotPath)
      try {
        mutateSnapshot(sqlite)
      } finally {
        sqlite.close()
      }
    }

    const filesDir = join(tempDir, 'files')
    const knowledgeDir = join(tempDir, 'knowledge')
    const skillsDir = join(tempDir, 'skills')
    const notesDir = join(tempDir, 'notes')
    await Promise.all([
      mkdir(filesDir, { recursive: true }),
      mkdir(join(knowledgeDir, 'knowledge-1'), { recursive: true }),
      mkdir(join(skillsDir, 'skill-1'), { recursive: true }),
      mkdir(notesDir, { recursive: true })
    ])
    await Promise.all([
      writeFile(join(filesDir, 'file-1'), 'file'),
      writeFile(join(knowledgeDir, 'knowledge-1', 'document.md'), 'knowledge'),
      writeFile(join(skillsDir, 'skill-1', 'SKILL.md'), 'skill'),
      writeFile(join(notesDir, 'note.md'), 'note')
    ])

    const archivePath = join(tempDir, 'archive.cbu')
    await assembleArchive(archivePath, {
      manifest,
      dbCopyPath: snapshotPath,
      filesDir,
      knowledgeDir,
      skillsDir,
      notesDir
    })
    return archivePath
  }

  async function createForwardMigrationBundle(): Promise<string> {
    const migrationsFolder = join(tempDir, 'forward-migrations')
    await cp(MIGRATIONS_FOLDER, migrationsFolder, { recursive: true })

    const journalPath = join(migrationsFolder, 'meta', '_journal.json')
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as MigrationJournal
    const last = journal.entries.at(-1)
    if (!last) throw new Error('production migration journal must contain at least one entry')

    const migration: MigrationJournalEntry = {
      idx: last.idx + 1,
      version: last.version,
      when: last.when + 1,
      tag: '9999_restore_prefix',
      breakpoints: true
    }
    await writeFile(join(migrationsFolder, `${migration.tag}.sql`), 'PRAGMA user_version = 0;\n')
    await writeFile(
      journalPath,
      `${JSON.stringify({ ...journal, entries: [...journal.entries, migration] }, null, 2)}\n`
    )
    return migrationsFolder
  }

  it('admits an exact-chain archive and extracts every recognized resource tree', async () => {
    const archivePath = await buildArchive()
    const workDir = join(tempDir, 'work')

    const context = await admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)

    expect(context.backupDbPath).toBe(join(workDir, 'backup.sqlite'))
    expect(context.domains).toEqual(['TOPICS'])
    expect(context.resourceMetadata).toEqual({
      fileIds: ['file-1'],
      knowledgeBases: ['knowledge-1'],
      skillFolders: [{ folderName: 'skill-1', contentHash: 'skill-hash' }],
      notePaths: ['note.md']
    })
    expect(existsSync(join(workDir, 'files', 'file-1'))).toBe(true)
    expect(existsSync(join(workDir, 'knowledge', 'knowledge-1', 'document.md'))).toBe(true)
    expect(existsSync(join(workDir, 'skills', 'skill-1', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(workDir, 'notes', 'note.md'))).toBe(true)

    const admitted = new Database(context.backupDbPath, { readonly: true })
    try {
      expect(readAppliedChain(admitted)).toEqual(readAppliedChain(dbh.sqlite))
      expect(admitted.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      admitted.close()
    }
  })

  it('migrates a strict-prefix archive forward to the bundled chain', async () => {
    const archivePath = await buildArchive()
    const migrationsFolder = await createForwardMigrationBundle()
    const workDir = join(tempDir, 'forward-work')

    const context = await admitArchive(archivePath, workDir, migrationsFolder)
    const expected = readMigrationFiles({ migrationsFolder }).map((migration) => ({
      folderMillis: migration.folderMillis,
      hash: migration.hash
    }))
    const admitted = new Database(context.backupDbPath, { readonly: true })
    try {
      expect(readAppliedChain(admitted)).toEqual(expected)
    } finally {
      admitted.close()
    }
  })

  it('rejects unsupported format versions and removes partial extraction', async () => {
    const archivePath = await buildArchive({ ...MANIFEST, backupFormatVersion: BACKUP_FORMAT_VERSION + 1 })
    const workDir = join(tempDir, 'unsupported-work')

    await expect(admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)).rejects.toBeInstanceOf(
      UnsupportedBackupFormatError
    )

    expect(existsSync(workDir)).toBe(false)
  })

  it('rejects a forked migration chain and removes partial extraction', async () => {
    const archivePath = await buildArchive(MANIFEST, (sqlite) => {
      const first = readAppliedChain(sqlite)[0]
      sqlite
        .prepare('UPDATE __drizzle_migrations SET hash = ? WHERE created_at = ?')
        .run('forked-hash', first.folderMillis)
    })
    const workDir = join(tempDir, 'forked-work')

    await expect(admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)).rejects.toBeInstanceOf(
      NewerOrDivergedBackupError
    )

    expect(existsSync(workDir)).toBe(false)
  })

  it('normalizes unreadable archives and removes the work directory', async () => {
    const archivePath = join(tempDir, 'corrupt.cbu')
    const workDir = join(tempDir, 'corrupt-work')
    await writeFile(archivePath, 'not a zip archive')

    await expect(admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)).rejects.toBeInstanceOf(
      BackupArchiveCorruptError
    )

    expect(existsSync(workDir)).toBe(false)
  })

  it('rejects absolute and traversal archive paths before extraction', () => {
    const workDir = join(tempDir, 'work')

    expect(() => assertWithin(workDir, 'files/file-1')).not.toThrow()
    expect(() => assertWithin(workDir, '../outside')).toThrow(BackupArchiveCorruptError)
    expect(() => assertWithin(workDir, '../../outside')).toThrow(BackupArchiveCorruptError)
    expect(() => assertWithin(workDir, '/outside')).toThrow(BackupArchiveCorruptError)
  })
})
