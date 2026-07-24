// Archive admission — spine step 0 of the restore pipeline (backup-architecture §9 step 0).
//
// Validates + safely unpacks a .cherrybackup archive into the restore staging subtree BEFORE
// quiesce/snapshot: format gate (backupFormatVersion major) → unpack (recognized entries,
// ignore unknown for forward-compat, zip-slip guard on ALL entries) → schema comparison
// (backup.sqlite applied chain vs bundled, 3 states) → migrate-forward on an independent
// connection → integrity_check → ArchiveContext.
//
// External .cherrybackup is untrusted input (vaayne A3): immutable admission limits bound manifest
// size, entry count, per-entry / cumulative uncompressed bytes, and compression ratio.
// Central-directory metadata is fail-fast advisory; actual stream bytes are authoritative.
//
// Failure cleanup (architecture §9 step 0): every SQLite/StreamZip handle is closed in a
// finally; any gate failure rm -rf's workDir and re-throws a normalized admission error.
// The live DB is NEVER touched (D-model restore — only the staging subtree is written).

import { createWriteStream, mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { applyMigrations } from '@main/data/db/applyMigrations'
import { type AppliedMigration, readAppliedChain } from '@main/data/db/restore/appliedChain'
import { backupErrorCodes } from '@shared/ipc/errors/backup'
import { IpcError } from '@shared/ipc/errors/IpcError'
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
import { resolvePreset } from './presets'
import { assertFullManifestInvariants } from './resourcePlanning'

/**
 * Recognized top-level archive entries. Unknown top-level entries are ignored (not
 * rejected) so a same-major additive format extension stays forward-compatible — only
 * an unsupported major is incompatible (import-orchestrator.md L132-134).
 */
/** Exact-match top-level entries (a sibling like `backup.sqlite.bak` must NOT be extracted). */
const RECOGNIZED_TOP_LEVEL = new Set(['backup.sqlite'])
/** Directory-prefixed trees extracted recursively (forward-compat: unknown top-levels ignored). */
const RECOGNIZED_DIR_PREFIXES = ['files/', 'knowledge/', 'notes/', 'skills/'] as const

const MANIFEST_ENTRY = 'manifest.json'

const MiB = 1024 * 1024
const GiB = 1024 * 1024 * 1024

/**
 * Immutable production admission budget for external .cherrybackup archives.
 * Units are bytes (except maxEntryCount / maxCompressionRatio). Values are code-owned —
 * never overridden by user settings or manifest self-report.
 */
export interface ArchiveAdmissionLimits {
  /** Hard cap on manifest.json uncompressed bytes (declared + actual). */
  readonly maxManifestBytes: number
  /** Cap on central-directory entry count (file + directory + unknown). */
  readonly maxEntryCount: number
  /** Cap on a single recognized non-manifest file entry's uncompressed bytes. */
  readonly maxEntryUncompressedBytes: number
  /** Cap on cumulative uncompressed bytes of manifest + recognized file entries. */
  readonly maxTotalUncompressedBytes: number
  /** Max size/compressedSize for non-empty extracted entries (inclusive). */
  readonly maxCompressionRatio: number
}

/**
 * Production restore safety limits (vaayne A3).
 * - 1 MiB manifest: JSON parse must stay bounded in the main process.
 * - 100k entries: bounds CD walk / path checks after library parse.
 * - 8 GiB / 32 GiB: absolute per-entry and cumulative staging write budget.
 * - 1000:1 ratio: soft ZIP-bomb gate; absolute size caps remain authoritative.
 */
export const DEFAULT_ARCHIVE_ADMISSION_LIMITS: ArchiveAdmissionLimits = Object.freeze({
  maxManifestBytes: 1 * MiB,
  maxEntryCount: 100_000,
  maxEntryUncompressedBytes: 8 * GiB,
  maxTotalUncompressedBytes: 32 * GiB,
  maxCompressionRatio: 1_000
})

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

/** Shared mutable cumulative byte counter for one admission attempt (serial extraction). */
interface CumulativeBudget {
  actualTotal: number
}

/**
 * One-shot classification of the ZIP central-directory snapshot. Built once after
 * `entries()` so manifest + bulk extract share the same plan (no second catalog read).
 */
interface AdmissionPlan {
  readonly manifestEntry: StreamZip.ZipEntry
  readonly recognizedFiles: readonly StreamZip.ZipEntry[]
}

/**
 * Admit a .cherrybackup archive into the restore staging subtree (backup-architecture §9 step 0).
 *
 * @param archivePath - Absolute path to the source .cherrybackup (untrusted input).
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
  return admitArchiveWithLimits(archivePath, workDir, migrationsFolder, DEFAULT_ARCHIVE_ADMISSION_LIMITS)
}

/**
 * Admission implementation with injectable limits. Production always uses
 * {@link DEFAULT_ARCHIVE_ADMISSION_LIMITS} via {@link admitArchive}; tests inject tiny
 * budgets so GiB-scale fixtures are unnecessary.
 *
 * @internal
 */
export async function admitArchiveWithLimits(
  archivePath: string,
  workDir: string,
  migrationsFolder: string,
  limits: ArchiveAdmissionLimits
): Promise<ArchiveContext> {
  // mkdir FIRST — the orchestrator calls admission before its own mkdirSync, so StreamZip
  // extract would otherwise target a nonexistent dir. 0700: the tree holds the extracted
  // backup.sqlite (plaintext secrets) until promotion deletes it (mode ignored on Windows).
  mkdirSync(workDir, { recursive: true, mode: 0o700 })

  let zip: StreamZip.StreamZipAsync | undefined
  let success = false
  try {
    zip = new StreamZip.async({ file: archivePath })

    // Catalog once → full preflight (count / zip-slip / declared sizes / ratio) BEFORE any
    // staging write. Manifest is still streamed before bulk payload so format gate stays first.
    const entries = await zip.entries()
    const plan = buildAdmissionPlan(entries, workDir, limits)
    const budget: CumulativeBudget = { actualTotal: 0 }

    // --- Format gate BEFORE bulk extract (architecture §9 step 0) ---
    const manifest = await extractAndReadManifest(zip, workDir, plan.manifestEntry, limits, budget)
    if (manifest.backupFormatVersion !== BACKUP_FORMAT_VERSION) {
      throw new UnsupportedBackupFormatError(manifest.backupFormatVersion, BACKUP_FORMAT_VERSION)
    }
    assertLiteManifestInvariants(manifest)
    // Full-preset cross-field invariants (domains / include* / unique ids) — no-op for lite.
    assertFullManifestInvariants(manifest)

    // --- Unpack recognized entries (ignore unknown; zip-slip already ran on ALL entries) ---
    await unpackRecognized(zip, workDir, plan.recognizedFiles, limits, budget)

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

/**
 * Classify + preflight the central-directory snapshot: entry-count, zip-slip on every name,
 * manifest presence, declared size/ratio/cumulative budget for extracted payloads.
 */
function buildAdmissionPlan(
  entries: Record<string, StreamZip.ZipEntry>,
  workDir: string,
  limits: ArchiveAdmissionLimits
): AdmissionPlan {
  const names = Object.keys(entries)
  if (names.length > limits.maxEntryCount) {
    throw new BackupArchiveCorruptError(`archive entry count exceeds limit (${names.length} > ${limits.maxEntryCount})`)
  }

  let manifestEntry: StreamZip.ZipEntry | undefined
  const recognizedFiles: StreamZip.ZipEntry[] = []
  let declaredTotal = 0

  for (const name of names) {
    const entry = entries[name]
    assertWithin(workDir, name)

    if (name === MANIFEST_ENTRY) {
      if (entry.isDirectory || name.endsWith('/')) {
        throw new BackupArchiveCorruptError('manifest.json is a directory entry')
      }
      assertSafeSizeMetadata(entry)
      assertUncompressedWithin(entry.size, limits.maxManifestBytes, 'manifest.json uncompressed size exceeds limit')
      assertCompressionRatio(entry, limits.maxCompressionRatio)
      declaredTotal = reserveDeclaredBytes(declaredTotal, entry.size, limits.maxTotalUncompressedBytes)
      manifestEntry = entry
      continue
    }

    // Directory entries: count + path guard only (no byte/ratio budget, no extract).
    if (entry.isDirectory || name.endsWith('/')) {
      continue
    }

    if (!isRecognized(name)) {
      // Unknown file: count + zip-slip only — payload ignored (same-major forward-compat).
      continue
    }

    assertSafeSizeMetadata(entry)
    assertUncompressedWithin(
      entry.size,
      limits.maxEntryUncompressedBytes,
      `entry '${safeEntryName(name)}' uncompressed size exceeds limit`
    )
    assertCompressionRatio(entry, limits.maxCompressionRatio)
    declaredTotal = reserveDeclaredBytes(declaredTotal, entry.size, limits.maxTotalUncompressedBytes)
    recognizedFiles.push(entry)
  }

  if (!manifestEntry) {
    throw new BackupArchiveCorruptError('missing or unreadable manifest.json')
  }

  return { manifestEntry, recognizedFiles }
}

/** Extract only manifest.json via bounded stream, then read + validate it. */
async function extractAndReadManifest(
  zip: StreamZip.StreamZipAsync,
  workDir: string,
  manifestEntry: StreamZip.ZipEntry,
  limits: ArchiveAdmissionLimits,
  budget: CumulativeBudget
): Promise<BackupManifest> {
  const dest = join(workDir, MANIFEST_ENTRY)
  // Manifest uses the tighter of declared size and maxManifestBytes; also shares total budget.
  const entryCap = Math.min(manifestEntry.size, limits.maxManifestBytes)
  await extractEntryBounded(zip, manifestEntry, dest, entryCap, limits.maxTotalUncompressedBytes, budget)
  try {
    return await readManifest(dest)
  } catch (e) {
    throw new BackupArchiveCorruptError(
      `manifest.json failed validation: ${e instanceof Error ? e.message : String(e)}`
    )
  }
}

/**
 * Extract recognized file entries from the preflight plan (serial). Unknown / directory /
 * manifest are already handled — no second `entries()` call.
 */
async function unpackRecognized(
  zip: StreamZip.StreamZipAsync,
  workDir: string,
  recognizedFiles: readonly StreamZip.ZipEntry[],
  limits: ArchiveAdmissionLimits,
  budget: CumulativeBudget
): Promise<void> {
  for (const entry of recognizedFiles) {
    const dest = join(workDir, entry.name)
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 })
    // Runtime cap = min(declared size, absolute per-entry): forged-small headers abort on the
    // first byte past declared size rather than waiting for the absolute GiB ceiling.
    const entryCap = Math.min(entry.size, limits.maxEntryUncompressedBytes)
    await extractEntryBounded(zip, entry, dest, entryCap, limits.maxTotalUncompressedBytes, budget)
  }
}

/**
 * Stream one entry to dest through a byte-limit Transform. NOT zip.extract() / entryData():
 * extract() lacks write-stream error handling (ENOSPC unhandled); entryData() buffers the
 * full uncompressed payload. pipeline propagates source + destination errors as a normal
 * rejection so outer catch + finally clean up without unbounded buffering.
 */
async function extractEntryBounded(
  zip: StreamZip.StreamZipAsync,
  entry: StreamZip.ZipEntry,
  dest: string,
  entryByteLimit: number,
  totalByteLimit: number,
  budget: CumulativeBudget
): Promise<void> {
  let src: NodeJS.ReadableStream
  try {
    src = await zip.stream(entry)
  } catch (e) {
    throw new BackupArchiveCorruptError(
      `failed to open entry '${safeEntryName(entry.name)}': ${e instanceof Error ? e.message : String(e)}`
    )
  }
  const limiter = createByteLimitTransform({
    entryName: entry.name,
    entryByteLimit,
    totalByteLimit,
    budget,
    declaredSize: entry.size
  })
  await pipeline(src, limiter, createWriteStream(dest))
}

/**
 * Transform that passes chunks through while enforcing per-entry and shared cumulative
 * uncompressed byte hard caps. Mutable budget is admission-scoped (serial extraction).
 *
 * @internal
 */
export function createByteLimitTransform(options: {
  entryName: string
  entryByteLimit: number
  totalByteLimit: number
  budget: CumulativeBudget
  /** When set, actual bytes past declared size are rejected as metadata mismatch. */
  declaredSize?: number
}): Transform {
  let entryActual = 0
  const label = safeEntryName(options.entryName)

  return new Transform({
    transform(chunk: Buffer | string, _encoding: BufferEncoding, callback: TransformCallback) {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      const chunkBytes = buf.byteLength

      if (entryActual + chunkBytes > options.entryByteLimit) {
        callback(
          new BackupArchiveCorruptError(
            options.declaredSize !== undefined && entryActual + chunkBytes > options.declaredSize
              ? `entry '${label}' produced more bytes than declared`
              : options.entryName === MANIFEST_ENTRY
                ? 'manifest.json uncompressed size exceeds limit'
                : `entry '${label}' uncompressed size exceeds limit`
          )
        )
        return
      }
      if (options.budget.actualTotal + chunkBytes > options.totalByteLimit) {
        callback(new BackupArchiveCorruptError('archive total uncompressed size exceeds limit'))
        return
      }

      entryActual += chunkBytes
      options.budget.actualTotal += chunkBytes
      callback(null, buf)
    }
  })
}

/**
 * Validate size/compressedSize are finite non-negative safe integers (fail-closed).
 *
 * @internal
 */
export function assertSafeSizeMetadata(entry: Pick<StreamZip.ZipEntry, 'name' | 'size' | 'compressedSize'>): void {
  if (!isSafeNonNegativeInt(entry.size) || !isSafeNonNegativeInt(entry.compressedSize)) {
    throw new BackupArchiveCorruptError(`entry '${safeEntryName(entry.name)}' has invalid size metadata`)
  }
}

/**
 * Compression-ratio gate for an extracted non-empty file entry.
 * Empty (`size === 0`) skips ratio (avoids 0/0). `size > 0 && compressedSize === 0` rejects.
 * Exact ratio limit is allowed (`BigInt` compare avoids float edge cases).
 *
 * @internal
 */
export function assertCompressionRatio(
  entry: Pick<StreamZip.ZipEntry, 'name' | 'size' | 'compressedSize'>,
  maxRatio: number
): void {
  if (entry.size === 0) return
  if (entry.compressedSize === 0) {
    throw new BackupArchiveCorruptError(`entry '${safeEntryName(entry.name)}' compression ratio exceeds limit`)
  }
  if (BigInt(entry.size) > BigInt(entry.compressedSize) * BigInt(maxRatio)) {
    throw new BackupArchiveCorruptError(`entry '${safeEntryName(entry.name)}' compression ratio exceeds limit`)
  }
}

/**
 * Remaining-budget reservation: reject before add when `entrySize` would exceed remaining.
 *
 * @internal
 */
export function reserveDeclaredBytes(declaredTotal: number, entrySize: number, maxTotal: number): number {
  if (entrySize > maxTotal - declaredTotal) {
    throw new BackupArchiveCorruptError('archive total uncompressed size exceeds limit')
  }
  return declaredTotal + entrySize
}

function assertUncompressedWithin(size: number, limit: number, message: string): void {
  if (size > limit) {
    throw new BackupArchiveCorruptError(message)
  }
}

function isSafeNonNegativeInt(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

/** Truncate + strip controls so untrusted entry names cannot inject log/error text. */
function safeEntryName(name: string): string {
  // Strip C0 controls (U+0000-U+001F) + DEL (U+007F) via charCode - a control-char
  // regex trips oxlint no-control-regex under --deny-warnings.
  const cleaned = Array.from(name)
    .filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0
      return cp > 0x1f && cp !== 0x7f
    })
    .join('')
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned
}

/** A recognized top-level entry: exact `backup.sqlite`, or any path under files/ knowledge/ notes/ skills/. */
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
/**
 * Lite preset semantic invariants (vaayne r3): untrusted archives can relabel
 * `preset` from full→lite; verify resource fields are empty, not just the label.
 *
 * @internal
 */
export function assertLiteManifestInvariants(manifest: BackupManifest): void {
  if (manifest.preset !== 'lite') return
  if (
    manifest.includeFiles !== false ||
    manifest.includeKnowledgeFiles !== false ||
    manifest.files.ids.length !== 0 ||
    manifest.files.total !== 0 ||
    manifest.knowledge.bases.length !== 0 ||
    manifest.skills.folders.length !== 0 ||
    manifest.notes.paths.length !== 0
  ) {
    throw new IpcError(
      backupErrorCodes.RESTORE_LITE_INVARIANT_VIOLATED,
      'backup: manifest claims lite but carries full resources — refusing restore'
    )
  }
  // Domains must exactly match resolvePreset('lite'): reject LITE_EXCLUDED (full→lite
  // relabel that zeros resources but keeps 14 domains) and reject duplicates.
  const expected = new Set(resolvePreset('lite'))
  const actual = new Set(manifest.domains)
  if (actual.size !== manifest.domains.length || actual.size !== expected.size) {
    throw new IpcError(
      backupErrorCodes.RESTORE_LITE_INVARIANT_VIOLATED,
      'backup: manifest claims lite but domains do not match the lite preset — refusing restore'
    )
  }
  for (const d of expected) {
    if (!actual.has(d)) {
      throw new IpcError(
        backupErrorCodes.RESTORE_LITE_INVARIANT_VIOLATED,
        'backup: manifest claims lite but domains do not match the lite preset — refusing restore'
      )
    }
  }
}

function normalizeAdmissionError(e: unknown): unknown {
  if (e instanceof IpcError) return e
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
