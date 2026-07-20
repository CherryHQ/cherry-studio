// Unit tests for admitArchive — restore spine step 0 (backup-architecture §9 step 0).
//
// Covers the trusted-backup admission contract: format gate BEFORE bulk extract,
// unpack (recognized + ignore unknown + zip-slip), schema-chain 3-state compare
// (equal / strict-prefix→migrate-forward / fork→reject) + empty→corrupt, post-migrate
// exact-equality re-read, integrity_check, and failure cleanup (rm -rf workDir).
//
// Fixture strategy: a real file-backed DB (setupTestDatabase, all production migrations) backs
// the equal-chain case; older-prefix uses a REAL prefix-migrations folder (only the first
// N .sql + a truncated _journal) applied to an independent DB — NOT a delete-last-row hack,
// so the prefix fixture's schema genuinely matches its chain (codex R1 P2-3).
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyMigrations } from '@main/data/db/applyMigrations'
import { setupTestDatabase } from '@test-helpers/db'
import { ZipArchive } from 'archiver'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { admitArchive, type ArchiveContext, assertWithin } from '../admitArchive'
import { assembleArchive } from '../archive'
import {
  BackupArchiveCorruptError,
  BackupIntegrityError,
  NewerOrDivergedBackupError,
  UnsupportedBackupFormatError
} from '../errors'
import { BACKUP_FORMAT_VERSION, type BackupManifest } from '../manifest'

// Production drizzle migrations folder (full 20-migration chain + bundled-chain source).
const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../migrations/sqlite-drizzle')

const MANIFEST: BackupManifest = {
  backupFormatVersion: BACKUP_FORMAT_VERSION,
  createdAt: '2026-07-04T12:00:00.000Z',
  preset: 'full',
  domains: ['PREFERENCES', 'PROVIDERS', 'FILE_STORAGE', 'KNOWLEDGE'],
  includeFiles: true,
  includeKnowledgeFiles: true,
  sensitiveData: { included: true, rotated: false },
  schemaMigrationId: '0001_abc.sql',
  producerAppVersion: '1.0.0',
  files: { ids: [], total: 0, totalBytes: 0 },
  knowledge: { bases: [] },
  skills: { folders: [] },
  notes: { paths: [] },
  degraded: { resources: [] }
}

describe('admitArchive', () => {
  // Real file-backed DB with all 20 production migrations → __drizzle_migrations chain
  // equals the bundled chain (the equal-chain fixture source).
  const dbh = setupTestDatabase()

  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cs-admit-'))
  })

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  /** Snapshot dbh (full schema + chain) into destPath via VACUUM INTO (consistent copy). */
  const snapshotDbhTo = (destPath: string): void => {
    dbh.sqlite.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`)
  }

  /** Build a real prefix-migrations folder (first N .sql + truncated _journal). */
  const buildPrefixFolder = (prefixCount: number): string => {
    const folder = mkdtempSync(join(tmpdir(), 'cs-prefix-mig-'))
    mkdirSync(join(folder, 'meta'), { recursive: true })
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
      entries: unknown[]
    }
    journal.entries = journal.entries.slice(0, prefixCount)
    writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal))
    const sqls = readdirSync(MIGRATIONS_FOLDER)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .slice(0, prefixCount)
    for (const f of sqls) copyFileSync(join(MIGRATIONS_FOLDER, f), join(folder, f))
    return folder
  }

  /** Build a backup DB whose chain is the first N migrations (REAL prefix schema). */
  const buildPrefixBackupDb = (prefixCount: number, destPath: string): void => {
    const folder = buildPrefixFolder(prefixCount)
    const sqlite = new Database(destPath)
    try {
      const db = drizzle({ client: sqlite, casing: 'snake_case' })
      applyMigrations(db, folder)
    } finally {
      sqlite.close()
    }
    rmSync(folder, { recursive: true, force: true })
  }

  /** Pack a fixture DB + manifest into a .cbu at outPath via the production assembler. */
  const packArchive = async (outPath: string, dbCopyPath: string, manifest: BackupManifest): Promise<void> => {
    await assembleArchive(outPath, { manifest, dbCopyPath })
  }

  /** Pack a .cbu with arbitrary entries (zip-slip / unknown-name fixtures the assembler can't express). */
  const packCustomArchive = async (
    outPath: string,
    entries: Array<{ name: string; content?: string; file?: string }>
  ): Promise<void> => {
    const archive = new ZipArchive({ zlib: { level: 1 } })
    const output = createWriteStream(outPath)
    const done = new Promise<void>((resolve, reject) => {
      output.on('close', resolve)
      output.on('error', reject)
      archive.on('error', reject)
    })
    archive.pipe(output)
    for (const e of entries) {
      if (e.file) archive.file(e.file, { name: e.name })
      else archive.append(Buffer.from(e.content ?? '', 'utf8'), { name: e.name })
    }
    archive.finalize()
    await done
  }

  it('equal chain → ArchiveContext, no migration (backup is at bundled tip)', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const archivePath = join(tmpDir, 'equal.cbu')
    await packArchive(archivePath, dbCopy, MANIFEST)
    const workDir = join(tmpDir, 'work')

    const ctx: ArchiveContext = await admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)

    expect(ctx.backupDbPath).toBe(join(workDir, 'backup.sqlite'))
    expect(ctx.manifest.backupFormatVersion).toBe(BACKUP_FORMAT_VERSION)
    expect(ctx.domains).toEqual(MANIFEST.domains)
    expect(ctx.resourceMetadata.fileIds).toEqual([])
    // workDir populated with the unpacked backup.sqlite
    expect(readFileSync(ctx.backupDbPath).byteLength).toBeGreaterThan(0)
  })

  it('older prefix chain → migrate-forward succeeds + post-migrate re-read equals bundled', async () => {
    // bundledTip is read live from the test DB (which runs every production migration), so the
    // test stays correct as main adds migrations — no hardcoded count to drift.
    const bundledTip = (dbh.sqlite.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as { n: number }).n
    const dbCopy = join(tmpDir, 'backup.sqlite')
    buildPrefixBackupDb(bundledTip - 1, dbCopy) // strict prefix (tip−1) → migrate-forward runs
    const archivePath = join(tmpDir, 'older.cbu')
    await packArchive(archivePath, dbCopy, MANIFEST)
    const workDir = join(tmpDir, 'work')

    const ctx = await admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)

    // migrate-forward advanced the backup DB to the full bundled chain — admission succeeded
    expect(ctx.backupDbPath).toBe(join(workDir, 'backup.sqlite'))
    const verify = new Database(ctx.backupDbPath, { readonly: true })
    try {
      const rows = verify.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').all() as Array<{ n: number }>
      expect(rows[0].n).toBe(bundledTip) // migrated to the bundled tip
    } finally {
      verify.close()
    }
  })

  it('forked chain (mid-chain hash mutated) → NewerOrDivergedBackupError', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    // Mutate a non-tip migration's hash → A B′ C (fork), neither equal nor strict prefix.
    const mutate = new Database(dbCopy)
    try {
      mutate.exec(
        "UPDATE __drizzle_migrations SET hash = 'deadbeef' WHERE created_at = (SELECT MIN(created_at) FROM __drizzle_migrations)"
      )
    } finally {
      mutate.close()
    }
    const archivePath = join(tmpDir, 'forked.cbu')
    await packArchive(archivePath, dbCopy, MANIFEST)
    const workDir = join(tmpDir, 'work')

    await expect(admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)).rejects.toThrow(NewerOrDivergedBackupError)
    // Failure cleanup — workDir removed (residue-free).
    expect(existsSync(workDir)).toBe(false)
  })

  it('equal-length mismatch (tip hash mutated, same length) → NewerOrDivergedBackupError', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const mutate = new Database(dbCopy)
    try {
      mutate.exec(
        "UPDATE __drizzle_migrations SET hash = 'deadbeef' WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)"
      )
    } finally {
      mutate.close()
    }
    const archivePath = join(tmpDir, 'mismatch.cbu')
    await packArchive(archivePath, dbCopy, MANIFEST)
    const workDir = join(tmpDir, 'work')

    await expect(admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)).rejects.toThrow(NewerOrDivergedBackupError)
    // Failure cleanup — workDir removed (residue-free).
    expect(existsSync(workDir)).toBe(false)
  })

  it('empty chain (no __drizzle_migrations) → BackupArchiveCorruptError (NOT old)', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const drop = new Database(dbCopy)
    try {
      drop.exec('DROP TABLE __drizzle_migrations')
    } finally {
      drop.close()
    }
    const archivePath = join(tmpDir, 'empty.cbu')
    await packArchive(archivePath, dbCopy, MANIFEST)
    const workDir = join(tmpDir, 'work')

    await expect(admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)).rejects.toThrow(BackupArchiveCorruptError)
    // Failure cleanup — workDir removed (residue-free).
    expect(existsSync(workDir)).toBe(false)
  })

  it('unsupported format version → UnsupportedBackupFormatError BEFORE payload extraction', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const archivePath = join(tmpDir, 'unsupported.cbu')
    await packArchive(archivePath, dbCopy, { ...MANIFEST, backupFormatVersion: 99 })
    const workDir = join(tmpDir, 'work')

    await expect(admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)).rejects.toThrow(UnsupportedBackupFormatError)
    // Format gate rejected before bulk extract → workDir has only manifest.json (no backup.sqlite),
    // and cleanup removed the whole tree.
    expect(existsSync(workDir)).toBe(false)
  })

  it('rejects zip-slip entry names via the path guard (defense-in-depth)', () => {
    const workDir = join(tmpDir, 'work')
    // Parent traversal, nested parent traversal, and absolute paths all escape workDir.
    // (Exercised as a direct unit test: the archiver the fixtures use sanitizes `../`
    // out of entry names, so a forged archive cannot reach this guard — a real malicious
    // archive would preserve the escape, which is exactly what this guard stops.)
    expect(() => assertWithin(workDir, '../escape.txt')).toThrow(BackupArchiveCorruptError)
    expect(() => assertWithin(workDir, 'files/../../escape.txt')).toThrow(BackupArchiveCorruptError)
    expect(() => assertWithin(workDir, '/etc/passwd')).toThrow(BackupArchiveCorruptError)
    // Recognized nested + root entries are allowed (legitimate files/<id> is one level deep).
    expect(() => assertWithin(workDir, 'files/file-1')).not.toThrow()
    expect(() => assertWithin(workDir, 'backup.sqlite')).not.toThrow()
  })

  it('integrity_check failure (corrupted user-table rootpage) → BackupIntegrityError', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    // Pick a user-table rootpage (NOT __drizzle_migrations / sqlite_sequence) and corrupt
    // its page header. __drizzle_migrations sits on a different page (chain gate reads it
    // fine), but PRAGMA integrity_check walks every table's B-tree and reports the damaged
    // page — exercising the integrity gate independently of the chain gate.
    const probe = new Database(dbCopy)
    let targetPage = 0
    try {
      const rows = probe
        .prepare(
          "SELECT rootpage FROM sqlite_master WHERE type='table' " +
            "AND name NOT IN ('__drizzle_migrations','sqlite_sequence') " +
            "AND sql NOT LIKE '%VIRTUAL%' " +
            "AND name NOT GLOB '*_fts' AND name NOT GLOB '*_fts_*'"
        )
        .all() as Array<{ rootpage: number }>
      // Highest rootpage = furthest from the schema/chain pages at the front of the file.
      targetPage = Math.max(...rows.map((r) => r.rootpage))
    } finally {
      probe.close()
    }
    expect(targetPage).toBeGreaterThan(0)
    const buf = readFileSync(dbCopy)
    const start = (targetPage - 1) * 4096
    for (let j = start; j < Math.min(start + 64, buf.length); j++) buf[j] = 0xff
    writeFileSync(dbCopy, buf)

    const archivePath = join(tmpDir, 'integrity.cbu')
    await packArchive(archivePath, dbCopy, MANIFEST)
    const workDir = join(tmpDir, 'work')

    await expect(admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)).rejects.toThrow(BackupIntegrityError)
    // Failure cleanup — workDir removed (residue-free).
    expect(existsSync(workDir)).toBe(false)
  })

  it('SQLite sidecar entries (backup.sqlite-wal/-shm/.bak) are NOT extracted (exact match)', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const archivePath = join(tmpDir, 'sidecar.cbu')
    await packCustomArchive(archivePath, [
      { content: JSON.stringify(MANIFEST), name: 'manifest.json' },
      { file: dbCopy, name: 'backup.sqlite' },
      { content: 'fake-wal', name: 'backup.sqlite-wal' },
      { content: 'fake-shm', name: 'backup.sqlite-shm' },
      { content: 'sibling', name: 'backup.sqlite.bak' }
    ])
    const workDir = join(tmpDir, 'work')

    const ctx = await admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)

    // Only the exact backup.sqlite extracted; SQLite sidecars + sibling ignored (codex R1 high-2).
    expect(existsSync(ctx.backupDbPath)).toBe(true)
    expect(existsSync(join(workDir, 'backup.sqlite-wal'))).toBe(false)
    expect(existsSync(join(workDir, 'backup.sqlite-shm'))).toBe(false)
    expect(existsSync(join(workDir, 'backup.sqlite.bak'))).toBe(false)
  })

  it('unknown top-level entry → admitted (same-major forward-compat, ignored not rejected)', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const archivePath = join(tmpDir, 'unknown.cbu')
    await packCustomArchive(archivePath, [
      { content: JSON.stringify(MANIFEST), name: 'manifest.json' },
      { file: dbCopy, name: 'backup.sqlite' },
      { content: 'additive-future-entry', name: 'unknown-future-dir/file.txt' }
    ])
    const workDir = join(tmpDir, 'work')

    const ctx = await admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)

    expect(ctx.backupDbPath).toBe(join(workDir, 'backup.sqlite'))
    // Unknown entry ignored — not extracted into workDir.
    expect(existsSync(join(workDir, 'unknown-future-dir'))).toBe(false)
  })

  it('succeeds from a nonexistent staging dir (admission self-creates workDir)', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const archivePath = join(tmpDir, 'ok.cbu')
    await packArchive(archivePath, dbCopy, MANIFEST)
    // workDir sits under a parent that does not exist yet — admission must mkdir -p it.
    const workDir = join(tmpDir, 'deep', 'nested', 'work')

    const ctx = await admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)

    expect(ctx.manifest.backupFormatVersion).toBe(BACKUP_FORMAT_VERSION)
    expect(existsSync(ctx.backupDbPath)).toBe(true)
  })
})
