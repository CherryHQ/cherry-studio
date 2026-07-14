import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import * as z from 'zod'

/**
 * Restore promotion journal — the crash-safe contract between the backup
 * staging pipeline (writer), the preboot promotion gate (consumer), and
 * orphan sweep (reader via hasPendingRestore). See ./README.md for the state
 * machine and ownership boundaries.
 *
 * The journal lives as a standalone sidecar file next to the database
 * (`feature.backup.restore.file`): the arbiter of a promotion cannot live
 * inside the databases being swapped, and boot-config is global-scoped with
 * debounced writes — both disqualified.
 *
 * Co-location with the database is a durability INVARIANT, not convenience:
 * every journal write fsyncs the shared parent directory, which also flushes
 * any not-yet-durable DB rename in that directory — so "marker at/past the
 * commit step" implies "the commit rename is durable" even when the rename's
 * own directory fsync failed. Relocating the journal into a different
 * directory breaks that coupling and reopens a power-loss window where a
 * completed journal survives a rolled-back rename (empty-DB boot).
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

/** Restore IDs are single safe path components, never traversal-capable names. */
export function isSafeRestoreId(value: string): boolean {
  return value.length > 0 && !value.includes('/') && !value.includes('\\') && !value.includes('..') && !value.includes('\0')
}

/** Journal paths are normalized relative paths under userData on both path dialects. */
export function isSafeJournalRelativePath(value: string): boolean {
  if (value.length === 0 || value.includes('\0') || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    return false
  }
  if (/^[A-Za-z]:/.test(value)) return false
  const segments = value.split(/[\\/]/)
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

const RestoreIdSchema = z.string().refine(isSafeRestoreId, 'restoreId must be a safe basename')
const RelativeJournalPathSchema = z
  .string()
  .refine(isSafeJournalRelativePath, 'journal path must be normalized and relative')

const RestoreDbSchema = z.strictObject({
  /** userData-relative path to the staged work.sqlite to promote. */
  promote: RelativeJournalPathSchema,
  /** userData-relative path the live DB is renamed to (the undo snapshot). */
  aside: RelativeJournalPathSchema,
  /** Hash of the live main file, post-TRUNCATE-checkpoint, busy==0 asserted. */
  fingerprint: z.string().min(1),
  /** Complete applied-migration sequence of work.sqlite — never empty. */
  chain: z.array(AppliedMigrationSchema).min(1)
})

const FileResourceSchema = z.strictObject({
  kind: z.enum(['blob-add', 'dir-add', 'note-add', 'note-overwrite', 'overwrite']),
  stagingPath: RelativeJournalPathSchema,
  livePath: RelativeJournalPathSchema,
  asidePath: RelativeJournalPathSchema.optional()
})

// All journal paths (db.*, fileResources[].*) are stored userData-relative;
// readers join them onto the currently resolved userData.
const commonFields = {
  version: z.literal(1),
  restoreId: RestoreIdSchema,
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
 * rename itself is durable (Windows moves are write-through; directory
 * handles cannot be fsynced there).
 */
export function writeRestoreJournal(journal: RestoreJournal): void {
  const journalPath = journalFilePath()
  const tmpPath = `${journalPath}.tmp`

  const fd = fs.openSync(tmpPath, 'w')
  try {
    fs.writeSync(fd, JSON.stringify(journal, null, 2))
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
