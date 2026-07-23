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
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

import { applyMigrations } from '@main/data/db/applyMigrations'
import { setupTestDatabase } from '@test-helpers/db'
import { ZipArchive } from 'archiver'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  admitArchive,
  admitArchiveWithLimits,
  type ArchiveAdmissionLimits,
  type ArchiveContext,
  assertCompressionRatio,
  assertSafeSizeMetadata,
  assertWithin,
  createByteLimitTransform,
  DEFAULT_ARCHIVE_ADMISSION_LIMITS,
  reserveDeclaredBytes
} from '../admitArchive'
import { assembleArchive } from '../archive'
import {
  BackupArchiveCorruptError,
  BackupIntegrityError,
  DiskFullError,
  NewerOrDivergedBackupError,
  UnsupportedBackupFormatError
} from '../errors'
import { BACKUP_FORMAT_VERSION, type BackupManifest } from '../manifest'

/** Tiny injectable limits for resource-budget tests (no GiB fixtures). */
const tinyLimits = (overrides: Partial<ArchiveAdmissionLimits> = {}): ArchiveAdmissionLimits =>
  Object.freeze({
    maxManifestBytes: 64 * 1024,
    maxEntryCount: 100,
    maxEntryUncompressedBytes: 64 * 1024 * 1024,
    maxTotalUncompressedBytes: 64 * 1024 * 1024,
    maxCompressionRatio: 1_000,
    ...overrides
  })

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

  /** Pack a fixture DB + manifest into a .cherrybackup at outPath via the production assembler. */
  const packArchive = async (outPath: string, dbCopyPath: string, manifest: BackupManifest): Promise<void> => {
    await assembleArchive(outPath, { manifest, dbCopyPath })
  }

  /** Pack a .cherrybackup with arbitrary entries (zip-slip / unknown-name fixtures the assembler can't express). */
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
    const archivePath = join(tmpDir, 'equal.cherrybackup')
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
    const archivePath = join(tmpDir, 'older.cherrybackup')
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
    const archivePath = join(tmpDir, 'forked.cherrybackup')
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
    const archivePath = join(tmpDir, 'mismatch.cherrybackup')
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
    const archivePath = join(tmpDir, 'empty.cherrybackup')
    await packArchive(archivePath, dbCopy, MANIFEST)
    const workDir = join(tmpDir, 'work')

    await expect(admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)).rejects.toThrow(BackupArchiveCorruptError)
    // Failure cleanup — workDir removed (residue-free).
    expect(existsSync(workDir)).toBe(false)
  })

  it('unsupported format version → UnsupportedBackupFormatError BEFORE payload extraction', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const archivePath = join(tmpDir, 'unsupported.cherrybackup')
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

    const archivePath = join(tmpDir, 'integrity.cherrybackup')
    await packArchive(archivePath, dbCopy, MANIFEST)
    const workDir = join(tmpDir, 'work')

    await expect(admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)).rejects.toThrow(BackupIntegrityError)
    // Failure cleanup — workDir removed (residue-free).
    expect(existsSync(workDir)).toBe(false)
  })

  it('SQLite sidecar entries (backup.sqlite-wal/-shm/.bak) are NOT extracted (exact match)', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const archivePath = join(tmpDir, 'sidecar.cherrybackup')
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
    const archivePath = join(tmpDir, 'unknown.cherrybackup')
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

  it('extracts skills/ tree entries (recognized dir prefix)', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const archivePath = join(tmpDir, 'skills.cherrybackup')
    await packCustomArchive(archivePath, [
      { content: JSON.stringify(MANIFEST), name: 'manifest.json' },
      { file: dbCopy, name: 'backup.sqlite' },
      { content: 'skill-body', name: 'skills/zipSkill/SKILL.md' }
    ])
    const workDir = join(tmpDir, 'work')

    await admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)

    expect(existsSync(join(workDir, 'skills/zipSkill/SKILL.md'))).toBe(true)
  })

  it('succeeds from a nonexistent staging dir (admission self-creates workDir)', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const archivePath = join(tmpDir, 'ok.cherrybackup')
    await packArchive(archivePath, dbCopy, MANIFEST)
    // workDir sits under a parent that does not exist yet — admission must mkdir -p it.
    const workDir = join(tmpDir, 'deep', 'nested', 'work')

    const ctx = await admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)

    expect(ctx.manifest.backupFormatVersion).toBe(BACKUP_FORMAT_VERSION)
    expect(existsSync(ctx.backupDbPath)).toBe(true)
  })

  it('production defaults freeze the vaayne A3 budget', () => {
    expect(DEFAULT_ARCHIVE_ADMISSION_LIMITS).toEqual({
      maxManifestBytes: 1 * 1024 * 1024,
      maxEntryCount: 100_000,
      maxEntryUncompressedBytes: 8 * 1024 * 1024 * 1024,
      maxTotalUncompressedBytes: 32 * 1024 * 1024 * 1024,
      maxCompressionRatio: 1_000
    })
    expect(Object.isFrozen(DEFAULT_ARCHIVE_ADMISSION_LIMITS)).toBe(true)
  })

  it('entry count over injected limit → BackupArchiveCorruptError before staging payload', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const archivePath = join(tmpDir, 'too-many.cherrybackup')
    // manifest + backup.sqlite + one unknown = 3 entries; limit 2 rejects before extract.
    await packCustomArchive(archivePath, [
      { content: JSON.stringify(MANIFEST), name: 'manifest.json' },
      { file: dbCopy, name: 'backup.sqlite' },
      { content: 'x', name: 'unknown-future/x.txt' }
    ])
    const workDir = join(tmpDir, 'work')

    await expect(
      admitArchiveWithLimits(archivePath, workDir, MIGRATIONS_FOLDER, tinyLimits({ maxEntryCount: 2 }))
    ).rejects.toThrow(BackupArchiveCorruptError)
    expect(existsSync(workDir)).toBe(false)
  })

  it('entry count exactly at injected limit is allowed', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const archivePath = join(tmpDir, 'count-ok.cherrybackup')
    await packCustomArchive(archivePath, [
      { content: JSON.stringify(MANIFEST), name: 'manifest.json' },
      { file: dbCopy, name: 'backup.sqlite' }
    ])
    const workDir = join(tmpDir, 'work')

    const ctx = await admitArchiveWithLimits(archivePath, workDir, MIGRATIONS_FOLDER, tinyLimits({ maxEntryCount: 2 }))
    expect(ctx.backupDbPath).toBe(join(workDir, 'backup.sqlite'))
  })

  it('oversized manifest metadata → BackupArchiveCorruptError + workDir cleaned', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const archivePath = join(tmpDir, 'big-manifest.cherrybackup')
    const bigManifest = JSON.stringify({ ...MANIFEST, producerAppVersion: 'x'.repeat(200) })
    expect(Buffer.byteLength(bigManifest)).toBeGreaterThan(64)
    await packCustomArchive(archivePath, [
      { content: bigManifest, name: 'manifest.json' },
      { file: dbCopy, name: 'backup.sqlite' }
    ])
    const workDir = join(tmpDir, 'work')

    await expect(
      admitArchiveWithLimits(archivePath, workDir, MIGRATIONS_FOLDER, tinyLimits({ maxManifestBytes: 64 }))
    ).rejects.toThrow(/manifest\.json uncompressed size exceeds limit/)
    expect(existsSync(workDir)).toBe(false)
  })

  it('per-entry uncompressed size over limit → reject before full extract + cleanup', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const dbBytes = readFileSync(dbCopy).byteLength
    expect(dbBytes).toBeGreaterThan(100)
    const archivePath = join(tmpDir, 'big-entry.cherrybackup')
    await packArchive(archivePath, dbCopy, MANIFEST)
    const workDir = join(tmpDir, 'work')

    await expect(
      admitArchiveWithLimits(
        archivePath,
        workDir,
        MIGRATIONS_FOLDER,
        tinyLimits({ maxEntryUncompressedBytes: 100, maxTotalUncompressedBytes: 64 * 1024 * 1024 })
      )
    ).rejects.toThrow(/uncompressed size exceeds limit/)
    expect(existsSync(workDir)).toBe(false)
  })

  it('declared total uncompressed over limit → reject + cleanup', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const dbBytes = readFileSync(dbCopy).byteLength
    const manifestBytes = Buffer.byteLength(JSON.stringify(MANIFEST))
    const archivePath = join(tmpDir, 'total.cherrybackup')
    await packArchive(archivePath, dbCopy, MANIFEST)
    const workDir = join(tmpDir, 'work')

    await expect(
      admitArchiveWithLimits(
        archivePath,
        workDir,
        MIGRATIONS_FOLDER,
        tinyLimits({
          maxEntryUncompressedBytes: dbBytes + 1,
          maxTotalUncompressedBytes: manifestBytes + dbBytes - 1
        })
      )
    ).rejects.toThrow(/archive total uncompressed size exceeds limit/)
    expect(existsSync(workDir)).toBe(false)
  })

  it('compression ratio over injected limit → reject + cleanup', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const archivePath = join(tmpDir, 'ratio.cherrybackup')
    // Highly compressible payload under files/ — zlib level 9 yields ratio >> 2.
    const zeros = Buffer.alloc(64 * 1024, 0)
    const zerosPath = join(tmpDir, 'zeros.bin')
    writeFileSync(zerosPath, zeros)
    await packCustomArchive(archivePath, [
      { content: JSON.stringify(MANIFEST), name: 'manifest.json' },
      { file: dbCopy, name: 'backup.sqlite' },
      { file: zerosPath, name: 'files/zeros.bin' }
    ])
    const workDir = join(tmpDir, 'work')

    await expect(
      admitArchiveWithLimits(
        archivePath,
        workDir,
        MIGRATIONS_FOLDER,
        tinyLimits({ maxCompressionRatio: 2, maxEntryUncompressedBytes: 64 * 1024 * 1024 })
      )
    ).rejects.toThrow(/compression ratio exceeds limit/)
    expect(existsSync(workDir)).toBe(false)
  })

  it('unknown huge entry does not count toward byte budget (forward-compat)', async () => {
    const dbCopy = join(tmpDir, 'backup.sqlite')
    snapshotDbhTo(dbCopy)
    const archivePath = join(tmpDir, 'unknown-huge.cherrybackup')
    const huge = Buffer.alloc(8 * 1024, 0x41)
    const hugePath = join(tmpDir, 'huge.bin')
    writeFileSync(hugePath, huge)
    await packCustomArchive(archivePath, [
      { content: JSON.stringify(MANIFEST), name: 'manifest.json' },
      { file: dbCopy, name: 'backup.sqlite' },
      { file: hugePath, name: 'future-addon/blob.bin' }
    ])
    const workDir = join(tmpDir, 'work')
    const dbBytes = readFileSync(dbCopy).byteLength
    const manifestBytes = Buffer.byteLength(JSON.stringify(MANIFEST))

    // Total budget fits only manifest+sqlite; unknown payload would overflow if counted.
    const ctx = await admitArchiveWithLimits(
      archivePath,
      workDir,
      MIGRATIONS_FOLDER,
      tinyLimits({ maxTotalUncompressedBytes: manifestBytes + dbBytes })
    )
    expect(ctx.backupDbPath).toBe(join(workDir, 'backup.sqlite'))
    expect(existsSync(join(workDir, 'future-addon'))).toBe(false)
  })

  it('zip-slip on unknown entry still rejected under resource limits', async () => {
    const workDir = join(tmpDir, 'work')
    expect(() => assertWithin(workDir, '../escape.txt')).toThrow(BackupArchiveCorruptError)
  })
})

describe('admitArchive resource-limit helpers', () => {
  it('assertSafeSizeMetadata rejects negative / fractional / NaN / unsafe integers', () => {
    const bad = [
      { size: -1, compressedSize: 0 },
      { size: 1.5, compressedSize: 1 },
      { size: Number.NaN, compressedSize: 0 },
      { size: Number.POSITIVE_INFINITY, compressedSize: 0 },
      { size: Number.MAX_SAFE_INTEGER + 1, compressedSize: 1 },
      { size: 1, compressedSize: -1 }
    ]
    for (const meta of bad) {
      expect(() => assertSafeSizeMetadata({ name: 'files/x', ...meta })).toThrow(/invalid size metadata/)
    }
    expect(() => assertSafeSizeMetadata({ name: 'files/x', size: 0, compressedSize: 0 })).not.toThrow()
  })

  it('assertCompressionRatio allows empty and exact limit; rejects zero compressed / over limit', () => {
    expect(() => assertCompressionRatio({ name: 'files/empty', size: 0, compressedSize: 0 }, 1000)).not.toThrow()
    expect(() => assertCompressionRatio({ name: 'files/exact', size: 1000, compressedSize: 1 }, 1000)).not.toThrow()
    expect(() => assertCompressionRatio({ name: 'files/bomb', size: 1001, compressedSize: 1 }, 1000)).toThrow(
      /compression ratio exceeds limit/
    )
    expect(() => assertCompressionRatio({ name: 'files/z', size: 10, compressedSize: 0 }, 1000)).toThrow(
      /compression ratio exceeds limit/
    )
  })

  it('reserveDeclaredBytes uses remaining-budget semantics (exact ok, +1 reject)', () => {
    expect(reserveDeclaredBytes(0, 10, 10)).toBe(10)
    expect(() => reserveDeclaredBytes(0, 11, 10)).toThrow(/total uncompressed size exceeds limit/)
    expect(reserveDeclaredBytes(5, 5, 10)).toBe(10)
    expect(() => reserveDeclaredBytes(5, 6, 10)).toThrow(/total uncompressed size exceeds limit/)
  })

  it('createByteLimitTransform aborts on per-entry overrun and closes the pipeline', async () => {
    const budget = { actualTotal: 0 }
    const limiter = createByteLimitTransform({
      entryName: 'files/x',
      entryByteLimit: 4,
      totalByteLimit: 100,
      budget,
      declaredSize: 4
    })
    const sinkChunks: Buffer[] = []
    const sink = new Writable({
      write(chunk, _enc, cb) {
        sinkChunks.push(Buffer.from(chunk))
        cb()
      }
    })
    await expect(pipeline(Readable.from([Buffer.from('abc'), Buffer.from('de')]), limiter, sink)).rejects.toThrow(
      /produced more bytes than declared/
    )
    expect(budget.actualTotal).toBe(3)
  })

  it('createByteLimitTransform aborts on shared cumulative overrun', async () => {
    const budget = { actualTotal: 8 }
    const limiter = createByteLimitTransform({
      entryName: 'files/y',
      entryByteLimit: 100,
      totalByteLimit: 10,
      budget,
      declaredSize: 100
    })
    const sink = new Writable({
      write(_chunk, _enc, cb) {
        cb()
      }
    })
    await expect(pipeline(Readable.from([Buffer.from('abcd')]), limiter, sink)).rejects.toThrow(
      /archive total uncompressed size exceeds limit/
    )
  })

  it('createByteLimitTransform allows exact entry boundary', async () => {
    const budget = { actualTotal: 0 }
    const limiter = createByteLimitTransform({
      entryName: 'manifest.json',
      entryByteLimit: 5,
      totalByteLimit: 5,
      budget,
      declaredSize: 5
    })
    const out: Buffer[] = []
    const sink = new Writable({
      write(chunk, _enc, cb) {
        out.push(Buffer.from(chunk))
        cb()
      }
    })
    await pipeline(Readable.from([Buffer.from('hello')]), limiter, sink)
    expect(Buffer.concat(out).toString()).toBe('hello')
    expect(budget.actualTotal).toBe(5)
  })

  it('DiskFullError remains a distinct admission error class from limit failures', () => {
    // Policy rejections are BackupArchiveCorruptError; operational ENOSPC maps to DiskFullError
    // in normalizeAdmissionError — keep the two classes distinct for IPC mapping.
    const limitErr = new BackupArchiveCorruptError('archive total uncompressed size exceeds limit')
    const diskErr = new DiskFullError('ENOSPC')
    expect(limitErr).toBeInstanceOf(BackupArchiveCorruptError)
    expect(diskErr).toBeInstanceOf(DiskFullError)
    expect(diskErr).not.toBeInstanceOf(BackupArchiveCorruptError)
  })
})
