// Archive admission for restore staging.
//
// Validates and safely unpacks an archive before writer quiescence. The live database
// is never opened here: all archive validation and migration happens in the restore
// staging directory on independent SQLite connections.

import { createWriteStream, mkdirSync } from 'node:fs'
import { rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { Transform } from 'node:stream'
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

/** Exact root entries allowed from the archive. */
const RECOGNIZED_TOP_LEVEL = new Set(['backup.sqlite'])
/** Resource trees copied only after the manifest format gate succeeds. */
const RECOGNIZED_DIR_PREFIXES = ['files/', 'knowledge/', 'skills/', 'notes/'] as const

/** Zip-bomb / staging-disk gates (central-directory metadata). */
export const MAX_ARCHIVE_ENTRIES = 100_000
export const MAX_MANIFEST_UNCOMPRESSED_BYTES = 16 * 1024 * 1024
/** Conservative staging cap — fail closed before filling the disk. */
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 16 * 1024 * 1024 * 1024
export const MAX_COMPRESSION_RATIO = 100

/** Minimal entry shape used by validateArchiveLimits (matches ZipEntry fields we read). */
export type ArchiveZipEntryLike = {
  readonly name: string
  readonly size: number
  readonly compressedSize: number
  readonly isDirectory?: boolean
}

/** Validated archive metadata passed to detached restore operations. */
export interface ArchiveContext {
  /** Absolute path to the independently migrated backup SQLite file. */
  readonly backupDbPath: string
  readonly manifest: BackupManifest
  readonly domains: BackupManifest['domains']
  readonly includeFiles: boolean
  /** Resource inventory reserved for the restore-resource staging implementation. */
  readonly resourceMetadata: {
    readonly fileIds: readonly string[]
    readonly knowledgeBases: readonly string[]
    readonly skillFolders: BackupManifest['skills']['folders']
    readonly notePaths: readonly string[]
  }
}

/**
 * Safely admit a backup archive into its restore staging directory.
 *
 * The archive format gate happens before bulk extraction. A compatible backup database
 * must have either the exact bundled migration chain or a strict-prefix chain that can
 * migrate forward to it; all other chains fail closed.
 */
export async function admitArchive(
  archivePath: string,
  workDir: string,
  migrationsFolder: string
): Promise<ArchiveContext> {
  mkdirSync(workDir, { recursive: true })

  let zip: StreamZip.StreamZipAsync | undefined
  let succeeded = false
  try {
    zip = new StreamZip.async({ file: archivePath })
    const entries = await zip.entries()
    validateArchiveLimits(entries)
    const manifest = await extractAndReadManifest(zip, workDir)
    if (manifest.backupFormatVersion !== BACKUP_FORMAT_VERSION) {
      throw new UnsupportedBackupFormatError(manifest.backupFormatVersion, BACKUP_FORMAT_VERSION)
    }

    await unpackRecognized(zip, workDir, entries)
    const backupDbPath = join(workDir, 'backup.sqlite')
    classifyAndMigrateChain(backupDbPath, migrationsFolder, manifest.producerAppVersion)
    assertIntegrity(backupDbPath)

    const context: ArchiveContext = {
      backupDbPath,
      manifest,
      domains: manifest.domains,
      includeFiles: manifest.includeFiles,
      resourceMetadata: {
        fileIds: manifest.files.ids,
        knowledgeBases: manifest.knowledge.bases,
        skillFolders: manifest.skills.folders,
        notePaths: manifest.notes.paths
      }
    }
    succeeded = true
    return context
  } catch (error) {
    throw normalizeAdmissionError(error)
  } finally {
    if (zip) {
      try {
        await zip.close()
      } catch {
        // A failed central-directory parse can prevent node-stream-zip from closing.
      }
    }
    if (!succeeded) {
      try {
        await rm(workDir, { recursive: true, force: true })
      } catch {
        // Startup residue recovery is the backstop for a failed cleanup.
      }
    }
  }
}

/** Extract and validate only the manifest before unpacking the payload. */
async function extractAndReadManifest(zip: StreamZip.StreamZipAsync, workDir: string): Promise<BackupManifest> {
  const manifestName = 'manifest.json'
  assertWithin(workDir, manifestName)

  let data: Buffer
  try {
    data = await zip.entryData(manifestName)
  } catch (error) {
    throw new BackupArchiveCorruptError(
      `missing or unreadable manifest.json: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (data.byteLength > MAX_MANIFEST_UNCOMPRESSED_BYTES) {
    throw new BackupArchiveCorruptError(
      `manifest.json extracted size exceeds limit (${data.byteLength} > ${MAX_MANIFEST_UNCOMPRESSED_BYTES})`
    )
  }

  await writeFile(join(workDir, manifestName), data)
  try {
    return await readManifest(join(workDir, manifestName))
  } catch (error) {
    throw new BackupArchiveCorruptError(
      `manifest.json failed validation: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Reject zip-bomb / staging-disk attacks using central-directory metadata before any
 * entryData()/stream() work. Directory entries are skipped for size/ratio totals.
 */
export function validateArchiveLimits(entries: Record<string, ArchiveZipEntryLike>): void {
  const names = Object.keys(entries)
  if (names.length > MAX_ARCHIVE_ENTRIES) {
    throw new BackupArchiveCorruptError(
      `archive entry count exceeds limit (${names.length} > ${MAX_ARCHIVE_ENTRIES})`
    )
  }

  const manifest = entries['manifest.json']
  if (!manifest || manifest.isDirectory || manifest.name.endsWith('/')) {
    throw new BackupArchiveCorruptError('missing or unreadable manifest.json')
  }
  if (manifest.size > MAX_MANIFEST_UNCOMPRESSED_BYTES) {
    throw new BackupArchiveCorruptError(
      `manifest.json uncompressed size exceeds limit (${manifest.size} > ${MAX_MANIFEST_UNCOMPRESSED_BYTES})`
    )
  }

  let totalUncompressed = 0
  for (const entry of Object.values(entries)) {
    if (entry.isDirectory || entry.name.endsWith('/')) continue
    totalUncompressed += entry.size
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new BackupArchiveCorruptError(
        `archive total uncompressed size exceeds limit (${totalUncompressed} > ${MAX_TOTAL_UNCOMPRESSED_BYTES})`
      )
    }
    if (entry.compressedSize > 0) {
      const ratio = entry.size / entry.compressedSize
      if (ratio > MAX_COMPRESSION_RATIO) {
        throw new BackupArchiveCorruptError(
          `archive entry compression ratio exceeds limit (${entry.name}: ${ratio.toFixed(1)} > ${MAX_COMPRESSION_RATIO})`
        )
      }
    }
  }
}

/** Extract recognized archive entries after validating every entry path for zip-slip. */
async function unpackRecognized(
  zip: StreamZip.StreamZipAsync,
  workDir: string,
  entries: Record<string, StreamZip.ZipEntry>
): Promise<void> {
  const budget = { remaining: MAX_TOTAL_UNCOMPRESSED_BYTES }
  for (const name of Object.keys(entries)) {
    assertWithin(workDir, name)
    if (name === 'manifest.json' || name.endsWith('/') || !isRecognized(name)) continue

    const destination = join(workDir, name)
    mkdirSync(dirname(destination), { recursive: true })
    await extractEntry(zip, name, destination, entries[name].size, budget)
  }
}

/** Stream an archive entry so large databases and resources are never buffered in memory. */
async function extractEntry(
  zip: StreamZip.StreamZipAsync,
  name: string,
  destination: string,
  declaredSize: number,
  budget: { remaining: number }
): Promise<void> {
  let source: NodeJS.ReadableStream
  try {
    source = await zip.stream(name)
  } catch (error) {
    throw new BackupArchiveCorruptError(
      `failed to open archive entry: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  let written = 0
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.length
      if (written > declaredSize) {
        callback(
          new BackupArchiveCorruptError(
            `archive entry exceeded declared size (${name}: ${written} > ${declaredSize})`
          )
        )
        return
      }
      if (written > budget.remaining) {
        callback(
          new BackupArchiveCorruptError(
            `archive extraction exceeded total uncompressed budget (${name}: wrote ${written}, remaining ${budget.remaining})`
          )
        )
        return
      }
      callback(null, chunk)
    }
  })

  try {
    await pipeline(source, limiter, createWriteStream(destination))
    budget.remaining -= written
  } catch (error) {
    await unlink(destination).catch(() => {})
    throw error
  }
}

/** Return whether an entry is one of the known archive payload paths. */
function isRecognized(name: string): boolean {
  return RECOGNIZED_TOP_LEVEL.has(name) || RECOGNIZED_DIR_PREFIXES.some((prefix) => name.startsWith(prefix))
}

/** Reject a zip entry whose resolved destination escapes the staging directory. */
export function assertWithin(baseDir: string, name: string): void {
  const root = resolve(baseDir)
  const destination = resolve(baseDir, name)
  if (destination !== root && !destination.startsWith(root + sep)) {
    throw new BackupArchiveCorruptError(`unsafe archive entry path: ${name}`)
  }
}

/** Classify the backup migration chain and migrate a compatible strict prefix forward. */
function classifyAndMigrateChain(backupDbPath: string, migrationsFolder: string, producerAppVersion: string): void {
  const bundled = readBundledChain(migrationsFolder)
  const gateDb = openReadonly(backupDbPath)
  let backupChain: AppliedMigration[]
  try {
    backupChain = readAppliedChainSafe(gateDb)
  } finally {
    gateDb.close()
  }

  if (backupChain.length === 0) {
    throw new BackupArchiveCorruptError('backup.sqlite has an empty migration chain')
  }
  if (chainEquals(backupChain, bundled)) return
  if (!isStrictPrefix(backupChain, bundled)) {
    throw new NewerOrDivergedBackupError(producerAppVersion)
  }

  migrateForward(backupDbPath, migrationsFolder)
  const migratedDb = openReadonly(backupDbPath)
  let migrated: AppliedMigration[]
  try {
    migrated = readAppliedChainSafe(migratedDb)
  } finally {
    migratedDb.close()
  }
  if (!chainEquals(migrated, bundled)) {
    throw new NewerOrDivergedBackupError(producerAppVersion)
  }
}

/** Read the authoritative bundled migration chain. */
function readBundledChain(migrationsFolder: string): AppliedMigration[] {
  return readMigrationFiles({ migrationsFolder }).map((migration) => ({
    folderMillis: migration.folderMillis,
    hash: migration.hash
  }))
}

/** Read an archive chain while reporting a missing journal as archive corruption. */
function readAppliedChainSafe(sqlite: Database.Database): AppliedMigration[] {
  try {
    return readAppliedChain(sqlite)
  } catch (error) {
    throw new BackupArchiveCorruptError(
      `backup.sqlite migration journal is unreadable: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/** Compare chains by ordered timestamp and content hash. */
function chainEquals(a: readonly AppliedMigration[], b: readonly AppliedMigration[]): boolean {
  return (
    a.length === b.length &&
    a.every((migration, index) => {
      const expected = b[index]
      return migration.folderMillis === expected.folderMillis && migration.hash === expected.hash
    })
  )
}

/** Determine whether one chain is a proper ordered prefix of another. */
function isStrictPrefix(prefix: readonly AppliedMigration[], full: readonly AppliedMigration[]): boolean {
  return (
    prefix.length < full.length &&
    prefix.every((migration, index) => {
      const expected = full[index]
      return migration.folderMillis === expected.folderMillis && migration.hash === expected.hash
    })
  )
}

/** Migrate an admitted backup database on its own writable connection. */
function migrateForward(backupDbPath: string, migrationsFolder: string): void {
  const sqlite = new Database(backupDbPath)
  try {
    const db = drizzle({ client: sqlite, casing: 'snake_case' })
    try {
      applyMigrations(db, migrationsFolder)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | { code?: string })?.code
      if (code === 'SQLITE_FULL' || code === 'ENOSPC') throw error
      throw new BackupArchiveCorruptError(
        `backup database migration failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  } finally {
    sqlite.close()
  }
}

/** Require SQLite integrity_check to return exactly one successful row. */
function assertIntegrity(backupDbPath: string): void {
  const sqlite = openReadonly(backupDbPath)
  try {
    let rows: Array<{ integrity_check: string }>
    try {
      rows = sqlite.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>
    } catch (error) {
      throw new BackupIntegrityError(error instanceof Error ? error.message : String(error))
    }
    if (rows.length !== 1 || rows[0].integrity_check !== 'ok') {
      throw new BackupIntegrityError(rows.map((row) => row.integrity_check).join('; '))
    }
  } finally {
    sqlite.close()
  }
}

/** Open an independent read-only connection for admission checks. */
function openReadonly(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true })
}

/** Preserve typed admission errors while normalizing archive and disk failures. */
function normalizeAdmissionError(error: unknown): unknown {
  if (
    error instanceof UnsupportedBackupFormatError ||
    error instanceof NewerOrDivergedBackupError ||
    error instanceof BackupIntegrityError ||
    error instanceof BackupArchiveCorruptError ||
    error instanceof DiskFullError
  ) {
    return error
  }
  const code = (error as NodeJS.ErrnoException | { code?: string })?.code
  if (code === 'ENOSPC' || code === 'SQLITE_FULL') {
    return new DiskFullError(error instanceof Error ? error.message : String(error))
  }
  return new BackupArchiveCorruptError(error instanceof Error ? error.message : String(error))
}
