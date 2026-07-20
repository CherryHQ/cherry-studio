// Archive admission — spine step 0 of the restore pipeline (backup-architecture §9 step 0).
//
// Validates + safely unpacks a .cbu archive into the restore staging subtree BEFORE
// quiesce/snapshot: format gate (backupFormatVersion major) → unpack (recognized entries,
// ignore unknown for forward-compat, zip-slip guard on ALL entries) → schema comparison
// (backup.sqlite applied chain vs bundled, 3 states) → migrate-forward on an independent
// connection → integrity_check → ArchiveContext. Trusted-backup model: the archive is the
// user's own .cbu (possibly cross-version/cross-build, NOT malicious); DoS-bound +
// DDL-equality hardening for the malicious-archive threat model is a separate task.
//
// Failure cleanup (architecture §9 step 0): every SQLite/StreamZip handle is closed in a
// finally; any gate failure rm -rf's workDir and re-throws a normalized admission error.
// The live DB is NEVER touched (D-model restore — only the staging subtree is written).

import { createWriteStream, mkdirSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'

import { applyMigrations } from '@main/data/db/applyMigrations'
import { type AppliedMigration, readAppliedChain } from '@main/data/db/restore/appliedChain'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import StreamZip from 'node-stream-zip'

import {
  BackupArchiveCorruptError,
  BackupIntegrityError,
  DiskFullError,
  NewerOrDivergedBackupError,
  UnsupportedBackupFormatError
} from './errors'
import { BACKUP_FORMAT_VERSION, type BackupManifest, readManifest } from './manifest'

/**
 * Recognized top-level archive entries. Unknown top-level entries are ignored (not
 * rejected) so a same-major additive format extension stays forward-compatible — only
 * an unsupported major is incompatible (import-orchestrator.md L132-134).
 */
/** Exact-match top-level entries (a sibling like `backup.sqlite.bak` must NOT be extracted). */
const RECOGNIZED_TOP_LEVEL = new Set(['backup.sqlite'])
/** Directory-prefixed trees extracted recursively (forward-compat: unknown top-levels ignored). */
const RECOGNIZED_DIR_PREFIXES = ['files/', 'knowledge/', 'notes/'] as const

/**
 * Result of admitting an archive — the validated, migrated backup DB + manifest-derived
 * metadata the downstream merge/stage steps consume. `backupDbPath` points at the
 * POST-migration state (migrate-forward ran on an independent connection before this
 * returns); consumers open it read-only.
 */
export interface ArchiveContext {
  /** Absolute path to the unpacked + migrated backup.sqlite in workDir. */
  readonly backupDbPath: string
  readonly manifest: BackupManifest
  /** Topo-sorted domains to merge (from manifest; consumer binding lands in spine-wiring). */
  readonly domains: BackupManifest['domains']
  readonly includeFiles: boolean
  /** File/knowledge/Note resource ids + paths for the staging step. */
  readonly resourceMetadata: {
    readonly fileIds: readonly string[]
    readonly knowledgeBases: readonly string[]
    readonly notePaths: readonly string[]
  }
}

/**
 * Admit a .cbu archive into the restore staging subtree (backup-architecture §9 step 0).
 *
 * @param archivePath - Absolute path to the source .cbu (untrusted input).
 * @param workDir - Absolute staging subtree to unpack into. Self-created here — the
 *   orchestrator's own mkdirSync runs AFTER the admission call, so admission must make it.
 * @param migrationsFolder - Production drizzle migrations folder (the bundled chain source).
 * @returns ArchiveContext pointing at the validated + migrated backup.sqlite.
 */
export async function admitArchive(
  archivePath: string,
  workDir: string,
  migrationsFolder: string
): Promise<ArchiveContext> {
  // mkdir FIRST — the orchestrator calls admission before its own mkdirSync, so StreamZip
  // extract would otherwise target a nonexistent dir.
  mkdirSync(workDir, { recursive: true })

  let zip: StreamZip.StreamZipAsync | undefined
  let success = false
  try {
    zip = new StreamZip.async({ file: archivePath })

    // --- Format gate BEFORE bulk extract (architecture §9 step 0) ---
    // Extract ONLY manifest.json, validate the major version, reject BEFORE pulling payload
    // so a large trusted-but-incompatible archive can't exhaust staging disk.
    const manifest = await extractAndReadManifest(zip, workDir)
    if (manifest.backupFormatVersion !== BACKUP_FORMAT_VERSION) {
      throw new UnsupportedBackupFormatError(manifest.backupFormatVersion, BACKUP_FORMAT_VERSION)
    }

    // --- Unpack recognized entries (ignore unknown; zip-slip guard on ALL entries) ---
    await unpackRecognized(zip, workDir)

    // --- Schema comparison (architecture §9 step 0): backup chain vs bundled ---
    const backupDbPath = join(workDir, 'backup.sqlite')
    classifyAndMigrateChain(backupDbPath, migrationsFolder, manifest.producerAppVersion)

    // --- Integrity check (post-migration state) ---
    assertIntegrity(backupDbPath)

    const ctx: ArchiveContext = {
      backupDbPath,
      manifest,
      domains: manifest.domains,
      includeFiles: manifest.includeFiles,
      resourceMetadata: {
        fileIds: manifest.files.ids,
        knowledgeBases: manifest.knowledge.bases,
        notePaths: manifest.notes.paths
      }
    }
    success = true
    return ctx
  } catch (e) {
    // Normalize raw parse/migration/StreamZip errors to admission errors; preserve an
    // already-typed admission error (version/fork/integrity/corrupt) as-is.
    throw normalizeAdmissionError(e)
  } finally {
    // Failure cleanup (architecture §9 step 0): close the zip on every path; on failure
    // also rm -rf workDir so a half-unpacked staging subtree never survives an admission
    // error (startup GC is the backstop if this cleanup itself throws).
    if (zip) {
      try {
        await zip.close()
      } catch {
        // best-effort — admission is already failing or already succeeded. Known node-stream-zip
        // limitation: if init (central-directory parse) failed after the descriptor opened,
        // close() awaits the rejected ready promise and never reaches the underlying close →
        // one descriptor leaks per such attempt (process-exit / startup reaper bounds it).
        // Patching/swapping the lib is deferred to the archive-hardening task (see prd.md).
      }
    }
    if (!success) {
      try {
        await rm(workDir, { recursive: true, force: true })
      } catch {
        // best-effort — startup GC catches residue on the next boot
      }
    }
  }
}

/** Extract only manifest.json, then read + validate it. Rejects (corrupt) if missing/invalid. */
async function extractAndReadManifest(zip: StreamZip.StreamZipAsync, workDir: string): Promise<BackupManifest> {
  const manifestName = 'manifest.json'
  assertWithin(workDir, manifestName)
  let data: Buffer
  try {
    data = await zip.entryData(manifestName)
  } catch (e) {
    throw new BackupArchiveCorruptError(
      `missing or unreadable manifest.json: ${e instanceof Error ? e.message : String(e)}`
    )
  }
  // writeFile ENOSPC/EIO propagates as-is → normalizeAdmissionError maps it to DiskFullError
  // (a valid archive on a full disk is not corrupt) — do NOT wrap as BackupArchiveCorruptError.
  await writeFile(join(workDir, manifestName), data)
  try {
    return await readManifest(join(workDir, manifestName))
  } catch (e) {
    throw new BackupArchiveCorruptError(
      `manifest.json failed validation: ${e instanceof Error ? e.message : String(e)}`
    )
  }
}

/**
 * Extract recognized entries (backup.sqlite / files/* / knowledge/* / notes/*). Unknown
 * top-level entries are ignored (forward-compat). Zip-slip guard runs on ALL entries
 * (recognized + ignored) so an escape attempt via an unknown name is still rejected.
 */
async function unpackRecognized(zip: StreamZip.StreamZipAsync, workDir: string): Promise<void> {
  const entries = await zip.entries()
  for (const name of Object.keys(entries)) {
    assertWithin(workDir, name)
    if (name === 'manifest.json') continue // already extracted
    // Skip directory entries: node-stream-zip's extract(dirEntry) recursively extracts
    // descendants, and the loop would then extract each child file again (duplicate writes).
    // Each file under files/ knowledge/ notes/ is extracted individually below (codex R1 medium-4).
    if (name.endsWith('/')) continue
    if (!isRecognized(name)) continue // ignore unknown (same-major forward-compat)
    const dest = join(workDir, name)
    mkdirSync(dirname(dest), { recursive: true })
    await extractEntry(zip, name, dest)
  }
}

/**
 * Extract one entry by streaming to dest (NOT zip.extract() and NOT entryData()).
 * node-stream-zip's extract() does not attach an error handler to its internal write stream,
 * so ENOSPC/EIO can surface as an UNHANDLED stream error that bypasses this await + the outer
 * cleanup (descriptor leak, workDir not removed) — codex R1 high-1. entryData() would buffer
 * the entire uncompressed entry (~2× DB size with Buffer.concat) → fatal OOM on a large
 * trusted backup before the outer finally can clean up — codex R2 high. pipeline over an
 * awaited zip.stream() propagates source + destination errors as a normal rejected promise
 * (the outer catch + finally clean up) without buffering.
 */
async function extractEntry(zip: StreamZip.StreamZipAsync, name: string, dest: string): Promise<void> {
  let src: NodeJS.ReadableStream
  try {
    // zip.stream is async (returns Promise<Readable>) — MUST await before pipeline.
    src = await zip.stream(name)
  } catch (e) {
    throw new BackupArchiveCorruptError(`failed to open entry '${name}': ${e instanceof Error ? e.message : String(e)}`)
  }
  // pipeline error (ENOSPC/EIO on the write side, or a zip read failure) propagates to the
  // outer catch, where normalizeAdmissionError maps ENOSPC/SQLITE_FULL → DiskFullError and
  // anything else → BackupArchiveCorruptError.
  await pipeline(src, createWriteStream(dest))
}

/** A recognized top-level entry: exact `backup.sqlite`, or any path under files/ knowledge/ notes/. */
function isRecognized(name: string): boolean {
  // backup.sqlite is an EXACT match — a sibling like `backup.sqlite.bak` must NOT be extracted
  // (a previous startsWith('backup.sqlite') prefix check let such siblings through).
  if (RECOGNIZED_TOP_LEVEL.has(name)) return true
  return RECOGNIZED_DIR_PREFIXES.some((p) => name.startsWith(p))
}

/**
 * Reject an entry whose resolved destination escapes workDir (zip-slip). Mirrors
 * assertZipEntriesWithin (McpPackageService) but per-entry; nested subdirs are allowed.
 *
 * Exported (marked @internal) so the zip-slip guard has a direct unit test — the archiver
 * the test fixture uses sanitizes `../` out of entry names, so the guard cannot be
 * exercised end-to-end via a forged archive (a real malicious archive would preserve it).
 * @internal
 */
export function assertWithin(baseDir: string, name: string): void {
  const root = resolve(baseDir)
  const dest = resolve(baseDir, name)
  if (dest !== root && !dest.startsWith(root + sep)) {
    throw new BackupArchiveCorruptError(`unsafe entry path (zip-slip): ${name}`)
  }
}

/**
 * Schema comparison + migrate-forward (architecture §9 step 0). Classifies the backup
 * chain against the bundled chain: empty → corrupt; equal → no-op; strict prefix →
 * migrate-forward then re-read for exact-equality; otherwise (fork / ahead / superset /
 * equal-length-mismatch) → NewerOrDivergedBackupError. Each SQLite handle is opened on
 * an INDEPENDENT connection (NOT the work/live DB) and closed in a finally.
 */
function classifyAndMigrateChain(backupDbPath: string, migrationsFolder: string, producerAppVersion: string): void {
  const bundled = readBundledChain(migrationsFolder)

  let backupChain: AppliedMigration[]
  const gateDb = openReadonly(backupDbPath)
  try {
    backupChain = readAppliedChainSafe(gateDb)
  } finally {
    gateDb.close()
  }

  if (backupChain.length === 0) {
    throw new BackupArchiveCorruptError('backup.sqlite has an empty migration chain (unmigrated)')
  }
  if (chainEquals(backupChain, bundled)) {
    return // equal → no migrate
  }
  if (isStrictPrefix(backupChain, bundled)) {
    migrateForward(backupDbPath, migrationsFolder)
    // Re-read the COMPLETE chain and require item-wise exact-equality with bundled —
    // drizzle migrate() is a silent no-op on ahead-of-chain, so this confirms the
    // migrator actually advanced to the bundled tip (architecture §9 step 0).
    let migrated: AppliedMigration[]
    const reDb = openReadonly(backupDbPath)
    try {
      migrated = readAppliedChainSafe(reDb)
    } finally {
      reDb.close()
    }
    if (!chainEquals(migrated, bundled)) {
      throw new NewerOrDivergedBackupError(producerAppVersion)
    }
    return
  }
  // fork / superset / ahead / equal-length-mismatch
  throw new NewerOrDivergedBackupError(producerAppVersion)
}

/** Read the bundled migration chain as { folderMillis, hash }[] (the authoritative target). */
function readBundledChain(migrationsFolder: string): AppliedMigration[] {
  const files = readMigrationFiles({ migrationsFolder })
  return files.map((f) => ({ folderMillis: f.folderMillis, hash: f.hash }))
}

/** readAppliedChain wraps a missing __drizzle_migrations table as BackupArchiveCorruptError. */
function readAppliedChainSafe(sqlite: Database.Database): AppliedMigration[] {
  try {
    return readAppliedChain(sqlite)
  } catch (e) {
    throw new BackupArchiveCorruptError(
      `backup.sqlite missing __drizzle_migrations: ${e instanceof Error ? e.message : String(e)}`
    )
  }
}

/** Item-wise folderMillis+hash equality (same length + each index matches). */
function chainEquals(a: readonly AppliedMigration[], b: readonly AppliedMigration[]): boolean {
  if (a.length !== b.length) return false
  return a.every((m, i) => m.folderMillis === b[i].folderMillis && m.hash === b[i].hash)
}

/** True when `prefix` is strictly shorter than `full` and matches it item-wise up to its length. */
function isStrictPrefix(prefix: readonly AppliedMigration[], full: readonly AppliedMigration[]): boolean {
  if (prefix.length >= full.length) return false
  return prefix.every((m, i) => m.folderMillis === full[i].folderMillis && m.hash === full[i].hash)
}

/**
 * Migrate backup.sqlite forward to the bundled latest. Opens a FRESH read-write connection
 * (NOT the work DB, NOT the live DB) and applies drizzle migrations + custom SQL. A raw
 * drizzle error is wrapped as BackupArchiveCorruptError (structural, not a version decision).
 */
function migrateForward(backupDbPath: string, migrationsFolder: string): void {
  const sqlite = new Database(backupDbPath)
  try {
    const db = drizzle({ client: sqlite, casing: 'snake_case' })
    try {
      applyMigrations(db, migrationsFolder)
    } catch (e) {
      // SQLITE_FULL (disk full mid-migrate) propagates → normalizeAdmissionError → DiskFullError.
      // Any other drizzle error is structural → BackupArchiveCorruptError (codex R1 high-3).
      const code = (e as NodeJS.ErrnoException | { code?: string })?.code
      if (code === 'SQLITE_FULL' || code === 'ENOSPC') throw e
      throw new BackupArchiveCorruptError(`migrate-forward failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  } finally {
    sqlite.close()
  }
}

/**
 * PRAGMA integrity_check must return exactly 'ok'. A PRAGMA that itself throws
 * (SQLITE_CORRUPT — the DB is too damaged for integrity_check to even run) is also
 * treated as BackupIntegrityError, not BackupArchiveCorruptError: the gate reached
 * the integrity step (chain + migrate passed), so the failure is structural damage
 * to the data image, not a version/chain decision.
 */
function assertIntegrity(backupDbPath: string): void {
  const sqlite = openReadonly(backupDbPath)
  try {
    let rows: Array<{ integrity_check: string }>
    try {
      rows = sqlite.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>
    } catch (e) {
      throw new BackupIntegrityError(`integrity_check could not run: ${e instanceof Error ? e.message : String(e)}`)
    }
    const ok = rows.length === 1 && rows[0].integrity_check === 'ok'
    if (!ok) {
      throw new BackupIntegrityError(`integrity_check returned: ${rows.map((r) => r.integrity_check).join('; ')}`)
    }
  } finally {
    sqlite.close()
  }
}

/** Open a readonly independent connection (chain gate + integrity check never write). */
function openReadonly(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true })
}

/**
 * Pass through an already-typed admission error; wrap any other thrown value (raw parse,
 * migration, or StreamZip error) as BackupArchiveCorruptError so the caller sees a stable
 * admission error class instead of a confusing low-level error.
 */
function normalizeAdmissionError(e: unknown): unknown {
  if (
    e instanceof UnsupportedBackupFormatError ||
    e instanceof NewerOrDivergedBackupError ||
    e instanceof BackupIntegrityError ||
    e instanceof BackupArchiveCorruptError ||
    e instanceof DiskFullError
  ) {
    return e
  }
  // Operational disk-full (staging ENOSPC or migrate SQLITE_FULL) → DiskFullError so the
  // renderer sees BACKUP_DISK_FULL, not BACKUP_ARCHIVE_CORRUPT — a valid archive on a full
  // disk is not corrupt (codex R1 high-3).
  const code = (e as NodeJS.ErrnoException | { code?: string })?.code
  if (code === 'ENOSPC' || code === 'SQLITE_FULL') {
    return new DiskFullError(e instanceof Error ? e.message : String(e))
  }
  return new BackupArchiveCorruptError(e instanceof Error ? e.message : String(e))
}
