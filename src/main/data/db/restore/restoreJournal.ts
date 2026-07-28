import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { RelativeSubpathSchema } from '@main/utils/relativePath'
import * as z from 'zod'

import { MAX_JOURNAL_DEGRADATIONS } from './restoreLimits'

/** On-disk contract for the final database-only restore transaction. */
export const RESTORE_JOURNAL_VERSION = 2 as const

export const PROMOTION_STEP_ORDER = [
  'gate-passed',
  'live-checkpointed',
  'sidecars-removed',
  'live-aside',
  'db-promoted',
  'integrity-ok'
] as const

export type PromotionStep = (typeof PROMOTION_STEP_ORDER)[number]

/** The database rename is the restore commit point. */
export const DB_COMMIT_STEP: PromotionStep = 'db-promoted'

const MigrationEntrySchema = z.strictObject({
  folderMillis: z.number().int().nonnegative(),
  hash: z.string().min(1)
})

const DbPromotionSchema = z
  .strictObject({
    promote: RelativeSubpathSchema,
    aside: RelativeSubpathSchema,
    chain: z.array(MigrationEntrySchema).min(1)
  })
  .refine((db) => db.promote !== db.aside, { message: 'db promote and aside paths must differ' })

const JournalDegradationSchema = z.strictObject({
  kind: z.string().min(1),
  reason: z.string().min(1)
})

const commonFields = {
  version: z.literal(RESTORE_JOURNAL_VERSION),
  restoreId: z.uuid(),
  createdAt: z.iso.datetime(),
  db: DbPromotionSchema,
  degradations: z.array(JournalDegradationSchema).max(MAX_JOURNAL_DEGRADATIONS).optional()
}

export const RestoreJournalSchema = z.discriminatedUnion('state', [
  z.strictObject({ ...commonFields, state: z.literal('prepared') }),
  z.strictObject({ ...commonFields, state: z.literal('armed') }),
  z.strictObject({ ...commonFields, state: z.literal('promoting'), step: z.enum(PROMOTION_STEP_ORDER) }),
  z.strictObject({
    ...commonFields,
    state: z.literal('reverting'),
    step: z.enum(PROMOTION_STEP_ORDER),
    reason: z.string().min(1)
  }),
  z.strictObject({ ...commonFields, state: z.literal('completed'), step: z.enum(PROMOTION_STEP_ORDER).optional() }),
  z.strictObject({
    ...commonFields,
    state: z.literal('rollback-armed'),
    step: z.enum(PROMOTION_STEP_ORDER).optional()
  }),
  z.strictObject({ ...commonFields, state: z.literal('rolled-back'), step: z.enum(PROMOTION_STEP_ORDER).optional() }),
  z.strictObject({
    ...commonFields,
    state: z.literal('failed'),
    step: z.enum(PROMOTION_STEP_ORDER).optional(),
    reason: z.string().min(1).optional()
  }),
  z.strictObject({
    ...commonFields,
    state: z.literal('expired'),
    step: z.enum(PROMOTION_STEP_ORDER).optional(),
    reason: z.string().min(1).optional()
  })
])

export type RestoreJournal = z.infer<typeof RestoreJournalSchema>
export type RestoreJournalState = RestoreJournal['state']
export type JournalDegradation = z.infer<typeof JournalDegradationSchema>

export type ReadJournalResult =
  | { readonly kind: 'ok'; readonly journal: RestoreJournal }
  | { readonly kind: 'invalid'; readonly error: string }
export type ReadJournalFileResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'corrupt'; readonly error: string }
  | { readonly kind: 'ok'; readonly journal: RestoreJournal }

/** Preboot dispatch only: never reinterpret a journal whose version is not known. */
export type RestoreJournalFormatVersion = 1 | 2 | 'none' | 'unknown'

/** This restore's staged main database, stored userData-relative for relocation. */
export function stagedDbRelPath(restoreId: string): string {
  const userData = application.getPath('app.userdata')
  return path.relative(
    userData,
    path.join(application.getPath('feature.backup.restore.staging'), restoreId, 'backup.sqlite')
  )
}

/** This restore's parked live database, always adjacent to its live database. */
export function dbAsideRelPath(restoreId: string): string {
  const userData = application.getPath('app.userdata')
  const livePath = application.getPath('app.database.file')
  return path.relative(
    userData,
    path.join(path.dirname(livePath), `${path.basename(livePath)}.pre-restore-${restoreId}`)
  )
}

/** Any DB aside left behind when an unreadable journal prevents targeted recovery. */
export function findDbAside(): string | null {
  const livePath = application.getPath('app.database.file')
  const dbDir = path.dirname(livePath)
  const prefix = `${path.basename(livePath)}.pre-restore-`
  try {
    const name = fs.readdirSync(dbDir).find((entry) => entry.startsWith(prefix))
    return name === undefined ? null : path.join(dbDir, name)
  } catch {
    return null
  }
}

/** Pure structural parse. Filesystem-bound path ownership is asserted by the reader below. */
export function parseRestoreJournal(value: unknown): ReadJournalResult {
  const result = RestoreJournalSchema.safeParse(value)
  return result.success ? { kind: 'ok', journal: result.data } : { kind: 'invalid', error: result.error.message }
}

function journalFilePath(): string {
  return application.getPath('feature.backup.restore.file')
}

/**
 * Reads only enough untrusted JSON to select a restore executor. Full schema
 * validation remains owned by that executor; unknown evidence must block boot.
 */
export function readRestoreJournalFormatVersion(): RestoreJournalFormatVersion {
  let raw: string
  try {
    raw = fs.readFileSync(journalFilePath(), 'utf8')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'none' : 'unknown'
  }
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'unknown'
    const version = (value as { version?: unknown }).version
    return version === 1 || version === RESTORE_JOURNAL_VERSION ? version : 'unknown'
  } catch {
    return 'unknown'
  }
}

function ownsExpectedPaths(journal: RestoreJournal): boolean {
  return (
    journal.db.promote === stagedDbRelPath(journal.restoreId) && journal.db.aside === dbAsideRelPath(journal.restoreId)
  )
}

/** Reads only this final journal format; old/future/ambiguous evidence is never reinterpreted. */
export function readRestoreJournal(): ReadJournalFileResult {
  let raw: string
  try {
    raw = fs.readFileSync(journalFilePath(), 'utf8')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { kind: 'none' }
      : { kind: 'corrupt', error: String(error) }
  }
  try {
    const result = parseRestoreJournal(JSON.parse(raw))
    if (result.kind !== 'ok') return { kind: 'corrupt', error: result.error }
    if (!ownsExpectedPaths(result.journal))
      return { kind: 'corrupt', error: 'journal paths do not match this restoreId' }
    return result
  } catch (error) {
    return { kind: 'corrupt', error: String(error) }
  }
}

/** Remove the journal last, after every rollback aside has been released. */
export function clearRestoreJournal(): void {
  const journalPath = journalFilePath()
  try {
    fs.unlinkSync(journalPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return
  }
  fsyncDir(path.dirname(journalPath))
}

export const restoreJournalIo: {
  writeSync(fd: number, bytes: Uint8Array, offset: number, length: number, position: number | null): number
} = {
  writeSync: (fd, bytes, offset, length, position) => fs.writeSync(fd, bytes, offset, length, position)
}

function writeBufferFully(fd: number, bytes: Buffer): void {
  let offset = 0
  while (offset < bytes.length) {
    const written = restoreJournalIo.writeSync(fd, bytes, offset, bytes.length - offset, null)
    if (written <= 0) throw new Error(`restore journal write made no progress at ${offset}/${bytes.length} bytes`)
    offset += written
  }
}

/** temp fsync → rename → parent fsync. Windows guarantees process-crash recovery only. */
export function writeRestoreJournal(journal: RestoreJournal): void {
  if (!ownsExpectedPaths(journal)) throw new Error('restore journal paths do not match this restoreId')
  const journalPath = journalFilePath()
  const tmpPath = `${journalPath}.tmp`
  const bytes = Buffer.from(JSON.stringify(journal, null, 2), 'utf8')
  const fd = fs.openSync(tmpPath, 'w')
  try {
    writeBufferFully(fd, bytes)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmpPath, journalPath)
  fsyncDir(path.dirname(journalPath))
}

function fsyncDir(dir: string): void {
  if (process.platform === 'win32') return
  const fd = fs.openSync(dir, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

/** Any extant non-terminal or corrupt journal protects restore artifacts from GC. */
export function hasPendingRestore(): boolean {
  const read = readRestoreJournal()
  return read.kind === 'corrupt' || (read.kind === 'ok' && !['failed', 'expired'].includes(read.journal.state))
}
