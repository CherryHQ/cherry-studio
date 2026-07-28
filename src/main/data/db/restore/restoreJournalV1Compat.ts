import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import * as z from 'zod'

/**
 * Compatibility reader/writer for a v1 restore that was already active when
 * the app upgraded to Backup v2. No new code creates this format; the preboot
 * gate keeps it only long enough to converge the old state machine safely.
 *
 * The journal lives as a standalone sidecar file next to the database
 * (`feature.backup.restore.file`): the arbiter of a promotion cannot live
 * inside the databases being swapped, and boot-config is global-scoped with
 * debounced writes — both disqualified.
 *
 * On POSIX, co-location with the database is a durability invariant: every
 * journal write fsyncs the shared parent directory, coupling a commit marker to
 * the DB rename. Relocating the journal breaks that coupling and reopens an
 * empty-DB power-loss window. The Windows compatibility contract is narrower:
 * process-crash recovery only, as documented by the writer below.
 */

/**
 * Write-ahead markers for the promotion sequence, in execution order.
 * Ordering comparisons MUST go through indexOf on this table — never compare
 * step strings lexicographically ('entries-applied' < 'work-promoted' holds
 * alphabetically but entries-applied runs AFTER the commit point; a string
 * comparison would misroute crash recovery into rollback and overwrite the
 * already-promoted database).
 */
export const PROMOTION_STEP_ORDER = [
  'gate-passed',
  'additive-moved',
  'sidecars-removed',
  'live-aside',
  'work-promoted',
  'entries-applied',
  'integrity-ok'
] as const

export type PromotionStep = (typeof PROMOTION_STEP_ORDER)[number]

const PromotionStepSchema = z.enum(PROMOTION_STEP_ORDER)

/**
 * One applied migration as recorded in `__drizzle_migrations`. The journal
 * stores the work database's COMPLETE applied sequence (read via
 * readAppliedChain, never from the app's bundled migration list) so the gate
 * can prefix-compare it against the app's bundled chain.
 */
const AppliedMigrationSchema = z.strictObject({
  folderMillis: z.number().int(),
  hash: z.string().min(1)
})

const RestoreDbSchema = z.strictObject({
  /** userData-relative path to the staged work.sqlite to promote. */
  promote: z.string().min(1),
  /** userData-relative path the live DB is renamed to (the undo snapshot). */
  aside: z.string().min(1),
  /** Hash of the live main file, post-TRUNCATE-checkpoint, busy==0 asserted. */
  fingerprint: z.string().min(1),
  /** Complete applied-migration sequence of work.sqlite — never empty. */
  chain: z.array(AppliedMigrationSchema).min(1)
})

const FileResourceSchema = z.strictObject({
  kind: z.enum(['blob-add', 'dir-add', 'note-add', 'note-overwrite', 'overwrite']),
  stagingPath: z.string().min(1),
  livePath: z.string().min(1),
  asidePath: z.string().min(1).optional()
})

// All journal paths (db.*, fileResources[].*) are stored userData-relative;
// readers join them onto the currently resolved userData.
const commonFields = {
  version: z.literal(1),
  restoreId: z.string().min(1),
  /** ISO-8601 timestamp, diagnostic only — the gate never reads it. */
  createdAt: z.string().min(1),
  db: RestoreDbSchema,
  fileResources: z.array(FileResourceSchema)
}

/**
 * Discriminated on `state`: staged has no step (it is set when the gate
 * transitions to promoting), promoting requires one, terminal states may keep
 * the last step for diagnostics. Strict objects + literal version: a future
 * journal v2 read by this version fails validation → corrupt → the gate
 * cleans up instead of misinterpreting it (fail-safe downgrade).
 */
export const RestoreJournalSchema = z.discriminatedUnion('state', [
  z.strictObject({ ...commonFields, state: z.literal('staged') }),
  z.strictObject({ ...commonFields, state: z.literal('promoting'), step: PromotionStepSchema }),
  z.strictObject({ ...commonFields, state: z.literal('completed'), step: PromotionStepSchema.optional() }),
  z.strictObject({ ...commonFields, state: z.literal('failed'), step: PromotionStepSchema.optional() }),
  z.strictObject({ ...commonFields, state: z.literal('expired'), step: PromotionStepSchema.optional() })
])

export type RestoreJournal = z.infer<typeof RestoreJournalSchema>
export type RestoreJournalState = RestoreJournal['state']

export type ReadJournalResult =
  | { kind: 'none' }
  | { kind: 'corrupt'; error: string }
  | { kind: 'ok'; journal: RestoreJournal }

function journalFilePath(): string {
  return application.getPath('feature.backup.restore.file')
}

export function readRestoreJournal(): ReadJournalResult {
  let raw: string
  try {
    raw = fs.readFileSync(journalFilePath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'none' }
    }
    // Unreadable ≠ absent: treat as corrupt so hasPendingRestore stays fail-safe.
    return { kind: 'corrupt', error: String(error) }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { kind: 'corrupt', error: String(error) }
  }

  const result = RestoreJournalSchema.safeParse(parsed)
  if (!result.success) {
    return { kind: 'corrupt', error: result.error.message }
  }
  return { kind: 'ok', journal: result.data }
}

/**
 * Crash-safe journal write: write-ahead to a `.tmp` sibling, fsync, rename
 * over the journal path, then fsync the parent directory on POSIX so the
 * rename itself is durable on POSIX. Node/libuv does not request
 * MOVEFILE_WRITE_THROUGH on Windows, so Windows guarantees process-crash
 * recovery only; sudden power loss can still roll metadata back.
 */
function writeBufferFully(fd: number, bytes: Buffer): void {
  let offset = 0
  while (offset < bytes.length) {
    const written = fs.writeSync(fd, bytes, offset, bytes.length - offset, null)
    if (written <= 0) throw new Error(`v1 restore journal write made no progress at ${offset}/${bytes.length} bytes`)
    offset += written
  }
}

export function writeRestoreJournal(journal: RestoreJournal): void {
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

  if (process.platform !== 'win32') {
    const dirFd = fs.openSync(path.dirname(journalPath), 'r')
    try {
      fs.fsyncSync(dirFd)
    } finally {
      fs.closeSync(dirFd)
    }
  }
}

/** Clear a converged v1 journal after upgrade; v1 had no user-facing rollback. */
export function clearRestoreJournal(): void {
  const journalPath = journalFilePath()
  try {
    fs.unlinkSync(journalPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (process.platform === 'win32') return
  const dirFd = fs.openSync(path.dirname(journalPath), 'r')
  try {
    fs.fsyncSync(dirFd)
  } finally {
    fs.closeSync(dirFd)
  }
}

/**
 * Whether a restore is staged or mid-promotion — the signal orphan sweep uses
 * to stand aside. Corrupt journals count as pending (fail-safe: one skipped
 * sweep is harmless; the next boot's gate cleans the corrupt journal up).
 */
export function hasPendingRestore(): boolean {
  const result = readRestoreJournal()
  if (result.kind === 'corrupt') {
    return true
  }
  return result.kind === 'ok' && (result.journal.state === 'staged' || result.journal.state === 'promoting')
}
