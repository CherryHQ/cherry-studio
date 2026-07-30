import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'

import { applyMigrations } from '@data/db/applyMigrations'
import { type AppliedMigration, readAppliedChain } from '@data/db/restore/appliedChain'
import { snapshotTo } from '@data/db/restore/snapshot'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import type { BackupManifest, ResourcePayload } from '../../manifest'

/**
 * Deliberate test-only helpers for archive-admission tests: a raw ZIP builder
 * with full control over hostile metadata (names, sizes, unix modes, duplicate
 * entries) that no legitimate producer can emit, plus production-migration DB
 * fixtures and variant migration folders. Nothing here weakens a production
 * ceiling — narrowed limits are passed per test instead.
 */

// ─── raw ZIP builder ───

export interface RawEntrySpec {
  /** Exact central-directory name bytes (may contain `\`, `..`, absolute prefixes, trailing `/`). */
  readonly name: string
  readonly data?: Buffer
  /** Unix mode for external attrs; default derives file/dir from the name. */
  readonly unixMode?: number
  /** General-purpose flags; set bit 0 for an "encrypted" entry. */
  readonly flags?: number
  /** Override the CENTRAL-directory uncompressed size (to lie about it). */
  readonly centralUncompressedSize?: number
  /** Override the CENTRAL-directory compressed size (zero-compressed edge). */
  readonly centralCompressedSize?: number
}

function defaultMode(name: string): number {
  return name.endsWith('/') ? 0o040755 : 0o100644
}

/** Assemble a STORED-only ZIP (no zip64, no data descriptor) from raw entry specs. */
export function buildRawZip(specs: readonly RawEntrySpec[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const spec of specs) {
    const data = spec.data ?? Buffer.alloc(0)
    const nameBuf = Buffer.from(spec.name, 'utf8')
    const crc = zlib.crc32(data) >>> 0
    const flags = spec.flags ?? 0
    const centralUnc = spec.centralUncompressedSize ?? data.length
    const centralComp = spec.centralCompressedSize ?? data.length

    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(flags, 6)
    lh.writeUInt16LE(0, 8) // STORED
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(data.length, 18) // local compressed
    lh.writeUInt32LE(data.length, 22) // local uncompressed
    lh.writeUInt16LE(nameBuf.length, 26)
    local.push(lh, nameBuf, data)

    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE((3 << 8) | 20, 4) // version made by: unix
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(flags, 8)
    ch.writeUInt16LE(0, 10) // STORED
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(centralComp, 20)
    ch.writeUInt32LE(centralUnc, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    const externalAttr = ((spec.unixMode ?? defaultMode(spec.name)) * 0x10000) >>> 0
    ch.writeUInt32LE(externalAttr, 38)
    ch.writeUInt32LE(offset, 42)
    central.push(ch, nameBuf)

    offset += 30 + nameBuf.length + data.length
  }

  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(specs.length, 8)
  eocd.writeUInt16LE(specs.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, centralBuf, eocd])
}

export async function writeRawZip(zipPath: string, specs: readonly RawEntrySpec[]): Promise<void> {
  await writeFile(zipPath, buildRawZip(specs))
}

// ─── DB fixtures ───

export interface DbMeta {
  readonly hash: string
  readonly sizeBytes: number
  readonly chain: readonly AppliedMigration[]
}

export function sha256Of(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** VACUUM INTO a fresh portable snapshot of a live test DB (chain = full bundled). */
export function snapshotDb(sqlite: Database.Database, destPath: string): void {
  snapshotTo(sqlite, destPath)
}

export async function dbMeta(dbPath: string): Promise<DbMeta> {
  const bytes = readFileSync(dbPath)
  const sqlite = new Database(dbPath, { fileMustExist: true, readonly: true })
  try {
    return { hash: sha256Of(bytes), sizeBytes: (await stat(dbPath)).size, chain: readAppliedChain(sqlite) }
  } finally {
    sqlite.close()
  }
}

/**
 * Build a fresh DB through the given migrations folder, using the same
 * foreign-key-safe wrapper as production. A truncated folder therefore yields
 * a genuine older-chain DB without bypassing migration safety.
 */
export function buildMigratedDb(destPath: string, migrationsFolder: string): void {
  const sqlite = new Database(destPath)
  try {
    applyMigrations(drizzle({ client: sqlite, casing: 'snake_case' }), migrationsFolder)
  } finally {
    sqlite.close()
  }
}

/** Persist WAL journal mode in a DB file's header, so a later open runs in WAL mode. */
export function setJournalModeWal(dbPath: string): void {
  const sqlite = new Database(dbPath, { fileMustExist: true })
  try {
    sqlite.pragma('journal_mode = WAL')
  } finally {
    sqlite.close()
  }
}

/** A structurally-valid but content-free DbMeta for tests that fail before DB verification. */
export function fakeDbMeta(): DbMeta {
  return { hash: '0'.repeat(64), sizeBytes: 1, chain: [{ folderMillis: 1, hash: 'x' }] }
}

// ─── variant migration folders ───

interface JournalEntry {
  readonly idx: number
  readonly tag: string
  readonly when: number
  readonly breakpoints: boolean
  readonly version: string
}

function readJournal(folder: string): { dialect: string; entries: JournalEntry[] } {
  return JSON.parse(readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8'))
}

/** Copy the first `count` migrations of `sourceFolder` into `destFolder`. */
export function buildTruncatedMigrations(sourceFolder: string, destFolder: string, count: number): void {
  const journal = readJournal(sourceFolder)
  const kept = journal.entries.slice(0, count)
  mkdirSync(path.join(destFolder, 'meta'), { recursive: true })
  writeFileSync(
    path.join(destFolder, 'meta', '_journal.json'),
    JSON.stringify({ dialect: journal.dialect, entries: kept })
  )
  for (const entry of kept) {
    cpSync(path.join(sourceFolder, `${entry.tag}.sql`), path.join(destFolder, `${entry.tag}.sql`))
  }
}

/**
 * Copy `sourceFolder` but append a harmless comment to migration `forkIndex`'s
 * SQL — same effect, different content hash — so a DB migrated with this folder
 * forks from the real chain at exactly `forkIndex`.
 */
export function buildForkedMigrations(sourceFolder: string, destFolder: string, forkIndex: number): void {
  const journal = readJournal(sourceFolder)
  mkdirSync(path.join(destFolder, 'meta'), { recursive: true })
  writeFileSync(path.join(destFolder, 'meta', '_journal.json'), JSON.stringify(journal))
  journal.entries.forEach((entry, i) => {
    const sql = readFileSync(path.join(sourceFolder, `${entry.tag}.sql`), 'utf8')
    const forked = i === forkIndex ? `${sql}\n-- forked variant\n` : sql
    writeFileSync(path.join(destFolder, `${entry.tag}.sql`), forked)
  })
}

// ─── manifest builders ───

const ISO = '2026-07-27T00:00:00.000Z'

/** A valid manifest carrying the database alone — no resource payloads. */
export function baseManifest(db: DbMeta): BackupManifest {
  return {
    backupFormatVersion: 2,
    createdAt: ISO,
    producer: { appVersion: '2.0.0', platform: 'darwin', managedRoots: [] },
    migrationChain: db.chain.map((m) => ({ folderMillis: m.folderMillis, hash: m.hash })),
    db: { hash: db.hash, sizeBytes: db.sizeBytes },
    resourceRequirements: [],
    degradations: [],
    preset: 'full',
    resourcePayloads: []
  }
}

export function fullManifest(db: DbMeta, resourcePayloads: readonly ResourcePayload[]): BackupManifest {
  return {
    ...baseManifest(db),
    resourcePayloads: [...resourcePayloads]
  }
}
