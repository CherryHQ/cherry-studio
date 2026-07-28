import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { portableCollisionKey, RelativeSubpathSchema } from '@main/utils/relativePath'
import * as z from 'zod'

import { MAX_JOURNAL_DEGRADATIONS, MAX_RESOURCE_INSTALL_ENTRIES } from './restoreLimits'

/**
 * Restore-promotion journal v2 — the crash-safe contract for the Backup v2
 * replacement flow (docs/references/backup/README.md §6). This is a
 * SIDE-BY-SIDE contract: the v1 journal (`./restoreJournal.ts`, `version: 1`,
 * state `staged`) and its promotion code stay live and untouched until the
 * promotion cutover. Both versions address the SAME sidecar file, so at most
 * one of them ever parses it; `./restoreGuard.ts` owns that cross-version
 * decision for readers that only need "is a restore holding storage".
 *
 * Version independence: `RESTORE_JOURNAL_VERSION` (the on-disk journal contract)
 * is distinct from the archive `BACKUP_FORMAT_VERSION`. Both being `2` is
 * coincidental — they version different artifacts and evolve independently.
 */
export const RESTORE_JOURNAL_VERSION = 2 as const

/**
 * Durable last-completed global steps for the v2 promotion sequence, in
 * execution order. The persisted `step` records the step that has ALREADY
 * completed (a durable marker, not a write-ahead intent) so recovery never
 * assumes an effect that a crash may have skipped.
 *
 * The live DB is **checkpoint-truncated first** (`live-checkpointed`), before
 * any resource effect: a checkpoint failure aborts with zero resource
 * mutations. Resource installs then run BEFORE the DB rename (`db-promoted`),
 * which is the commit point. Ordering comparisons MUST go through `indexOf` on
 * this table, never lexicographic string compare (see v1's identical warning) —
 * `phaseForStep` in `./restoreRecovery.ts` is the canonical reader.
 */
export const PROMOTION_STEP_ORDER_V2 = [
  'gate-passed',
  'live-checkpointed',
  'resources-installed',
  'sidecars-removed',
  'live-aside',
  'db-promoted',
  'integrity-ok'
] as const

export type PromotionStepV2 = (typeof PROMOTION_STEP_ORDER_V2)[number]

/** The commit boundary: at or past this step the promotion is committed. */
export const DB_COMMIT_STEP: PromotionStepV2 = 'db-promoted'

const PromotionStepSchema = z.enum(PROMOTION_STEP_ORDER_V2)

/**
 * One applied migration in the staged DB's COMPLETE chain. Same shape and
 * semantics as `AppliedMigration` / `readAppliedChain` (folderMillis + hash);
 * the array must be the full applied sequence and is never empty.
 */
const MigrationEntrySchema = z.strictObject({
  folderMillis: z.number().int().nonnegative(),
  hash: z.string().min(1)
})

/** Whether a set of relative paths is pairwise-distinct under the portable collision policy. */
function pathsPairwiseDistinct(paths: readonly string[]): boolean {
  const keys = paths.map(portableCollisionKey)
  return new Set(keys).size === keys.length
}

/**
 * One unified `resource-install` unit (§6.3). All paths are userData-relative
 * (relocation-safe, §6.6): `staging` the staged source, `live` the registered
 * destination, `aside` the reserved restore-specific park slot. The three MUST
 * be pairwise distinct under the same collision policy the resource-path
 * validator uses — an entry whose staging and aside (say) alias to one file on
 * a case-insensitive FS would corrupt its own rename sequence.
 */
const ResourceInstallEntrySchema = z
  .strictObject({
    resourceType: z.enum(['file', 'directory']),
    staging: RelativeSubpathSchema,
    live: RelativeSubpathSchema,
    aside: RelativeSubpathSchema
  })
  .refine((entry) => pathsPairwiseDistinct([entry.staging, entry.live, entry.aside]), {
    message: 'resource-install staging/live/aside paths must be pairwise distinct'
  })

/**
 * DB promotion payload. No `fingerprint`: v2 drops the fingerprint (§6.1). The
 * staged `promote` DB and its `aside` park slot must be distinct paths.
 */
const DbPromotionSchema = z
  .strictObject({
    promote: RelativeSubpathSchema,
    aside: RelativeSubpathSchema,
    chain: z.array(MigrationEntrySchema).min(1)
  })
  .refine((db) => pathsPairwiseDistinct([db.promote, db.aside]), {
    message: 'db promote and aside paths must be distinct'
  })

/**
 * Durable restore summary written when a promotion completes. Kept minimal: the
 * only demand that already exists is the post-promotion Knowledge reindex
 * scheduler (§6.7 / plan Phase 3), which needs the base IDs of Knowledge bases
 * installed or already present in the restored DB. `strictObject` so later
 * phases add fields deliberately, never silently.
 */
const uniqueKnowledgeBaseIds = z
  .array(z.string().min(1))
  .max(MAX_RESOURCE_INSTALL_ENTRIES)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'knowledge-base IDs must be unique'
  })

const RestoreSummarySchema = z.strictObject({
  knowledgeBaseIds: uniqueKnowledgeBaseIds
})

/** Durable completion or the user's explicit decision to stop derived rebuilding. */
const KnowledgeRebuildSchema = z.strictObject({
  completedBaseIds: uniqueKnowledgeBaseIds,
  /** The restored DB stays live, but missing derived index material is accepted. */
  abandoned: z.literal(true).optional()
})

/**
 * One aggregated line of "what this restore reduced", as produced by
 * `summarizeMaterializationDegradations`. Kept structural (`kind` + `reason`)
 * rather than typed to the materializer's enums: the journal is a durable
 * on-disk contract read by a LATER app version, and pinning it to today's
 * reason list would make tomorrow's new reason unparseable and block startup
 * over a report string rather than a recovery fact.
 */
const JournalDegradationSchema = z.strictObject({
  kind: z.string().min(1),
  reason: z.string().min(1),
  /** Bounded display-only resource unit path; never an install input. */
  livePath: RelativeSubpathSchema.optional()
})

const commonFields = {
  version: z.literal(RESTORE_JOURNAL_VERSION),
  /** Producer-generated UUID (the chosen restore-id contract). */
  restoreId: z.uuid(),
  /** The archive's preset. Only Full exists; kept so a second preset stays additive. */
  preset: z.literal('full'),
  /** ISO-8601 timestamp, diagnostic only. */
  createdAt: z.iso.datetime(),
  db: DbPromotionSchema,
  resourceInstalls: z.array(ResourceInstallEntrySchema).max(MAX_RESOURCE_INSTALL_ENTRIES),
  /**
   * What materializing THIS archive against THIS device reduced (§4). Carried by
   * the journal because the restore report is rendered after a relaunch, by
   * which point the staging tree that produced it may already be gone — and a
   * degraded restore must never look like a complete one. Optional, and omitted
   * when empty, so there is exactly one way to say "nothing was reduced".
   */
  degradations: z.array(JournalDegradationSchema).max(MAX_JOURNAL_DEGRADATIONS).optional()
}

/**
 * Discriminated on `state`. `prepared`/`armed` carry no step (promotion has not
 * begun); `promoting` requires the last-completed step. A post-commit failure
 * writes `reverting` before reverse mutation. A `completed` restore may become
 * `rollback-armed` only by explicit user consent; `rolled-back` is its reverse
 * terminal. Successful states carry the durable `summary` the post-promotion
 * reindex scheduler consumes; `failed`/`expired` carry an
 * optional terminal `reason` for post-boot reporting. `strictObject` +
 * `version: z.literal(2)` make a downgraded v1 parser reject a v2 journal (and
 * vice-versa): unknown version/fields → parse failure → the gate preserves the
 * evidence and refuses normal startup rather than reinterpreting it (§5.2).
 */
const journalVariants = [
  z.strictObject({ ...commonFields, state: z.literal('prepared') }),
  z.strictObject({ ...commonFields, state: z.literal('armed') }),
  z.strictObject({
    ...commonFields,
    state: z.literal('promoting'),
    step: PromotionStepSchema
  }),
  z.strictObject({
    ...commonFields,
    state: z.literal('reverting'),
    step: PromotionStepSchema,
    reason: z.string().min(1)
  }),
  z.strictObject({
    ...commonFields,
    state: z.literal('completed'),
    step: PromotionStepSchema.optional(),
    summary: RestoreSummarySchema,
    /**
     * The database is live, but a resource unit did not reach its installed
     * state — so somewhere on disk a unit's only remaining copies are its
     * staging source and its aside. `completed` alone would let acknowledgement
     * delete both and leave that unit with nothing (§6.5). Absent means every
     * unit is installed; `true` is the only other value.
     */
    resourcesIncomplete: z.literal(true).optional(),
    knowledgeRebuild: KnowledgeRebuildSchema.optional()
  }),
  z.strictObject({
    ...commonFields,
    state: z.literal('rollback-armed'),
    step: PromotionStepSchema.optional(),
    summary: RestoreSummarySchema,
    knowledgeRebuild: KnowledgeRebuildSchema.optional()
  }),
  z.strictObject({
    ...commonFields,
    state: z.literal('rolled-back'),
    step: PromotionStepSchema.optional(),
    summary: RestoreSummarySchema,
    knowledgeRebuild: KnowledgeRebuildSchema.optional()
  }),
  z.strictObject({
    ...commonFields,
    state: z.literal('failed'),
    step: PromotionStepSchema.optional(),
    reason: z.string().min(1).optional(),
    /**
     * The rollback could not put every unit back, so this journal's asides are
     * still the only copy of what they hold — `failed` alone would let the GC
     * guard and acknowledgement treat them as spent (§6.5). Absent means the
     * rollback finished; `true` is the only other value, so there is exactly one
     * way to say each thing.
     */
    recoveryIncomplete: z.literal(true).optional()
  }),
  z.strictObject({
    ...commonFields,
    state: z.literal('expired'),
    step: PromotionStepSchema.optional(),
    reason: z.string().min(1).optional()
  })
] as const

export const RestoreJournalV2Schema = z
  .discriminatedUnion('state', journalVariants)
  .refine(
    (journal) =>
      !('knowledgeRebuild' in journal) ||
      journal.knowledgeRebuild === undefined ||
      journal.knowledgeRebuild.completedBaseIds.every((id) => journal.summary.knowledgeBaseIds.includes(id)),
    {
      message: 'completed knowledge rebuild IDs must belong to the restore summary',
      path: ['knowledgeRebuild', 'completedBaseIds']
    }
  )

export type RestoreJournalV2 = z.infer<typeof RestoreJournalV2Schema>
export type RestoreJournalV2State = RestoreJournalV2['state']
export type ResourceInstallEntry = z.infer<typeof ResourceInstallEntrySchema>
export type JournalDegradation = z.infer<typeof JournalDegradationSchema>
export type RestoreSummary = z.infer<typeof RestoreSummarySchema>

/**
 * Park slot for the live database, named per restore and owned here.
 *
 * The name is a contract between the code that creates the slot and the recovery
 * that has to FIND it when the journal naming it can no longer be parsed
 * ({@link findDbAside}), so the two cannot be allowed to drift apart. A fixed
 * name would let a stale aside from an earlier restore be mistaken for this
 * one's rollback source — the recovery table decides from `(staged, live,
 * aside)` existence, so an aside belonging to a different restore is worse than
 * no aside at all.
 */
export function dbAsideRelPathV2(restoreId: string): string {
  return `${dbAsidePrefix()}${restoreId}`
}

/**
 * The prefix every park slot shares. A function, not a constant: resolving it at
 * import time would read the path registry before preboot freezes it.
 */
function dbAsidePrefix(): string {
  return `${path.basename(application.getPath('app.database.file'))}.pre-restore-`
}

/**
 * Any park slot left on disk, or `null`. Used when the journal is unreadable and
 * the only remaining evidence that a database was parked is the file itself.
 */
export function findDbAside(): string | null {
  const userData = application.getPath('app.userdata')
  let names: string[]
  try {
    names = fs.readdirSync(userData)
  } catch {
    return null
  }
  const prefix = dbAsidePrefix()
  const found = names.find((name) => name.startsWith(prefix))
  return found === undefined ? null : path.join(userData, found)
}

export type ReadJournalV2Result =
  | { readonly kind: 'ok'; readonly journal: RestoreJournalV2 }
  | { readonly kind: 'invalid'; readonly error: string }

/** Pure structural parse — no I/O. The file readers below wrap this. */
export function parseRestoreJournalV2(value: unknown): ReadJournalV2Result {
  const result = RestoreJournalV2Schema.safeParse(value)
  return result.success ? { kind: 'ok', journal: result.data } : { kind: 'invalid', error: result.error.message }
}

/**
 * The journal is a standalone sidecar in the database's own directory
 * (`feature.backup.restore.file`). On POSIX that co-location is a durability
 * invariant: fsyncing the shared parent couples the step marker to the DB rename.
 * Moving it elsewhere reopens a power-loss window where a completed journal
 * survives a rolled-back rename. Windows cannot make that metadata ordering
 * claim through Node/libuv; co-location still keeps process-crash recovery and
 * path ownership simple, while sudden power loss remains outside the guarantee.
 */
function journalFilePath(): string {
  return application.getPath('feature.backup.restore.file')
}

export type RestoreJournalFormatVersion = 1 | 2 | 'none' | 'unknown'

/** Peek only the on-disk version so the preboot gate can dispatch an active v1 upgrade safely. */
export function readRestoreJournalFormatVersion(): RestoreJournalFormatVersion {
  let raw: string
  try {
    raw = fs.readFileSync(journalFilePath(), 'utf8')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'none' : 'unknown'
  }
  try {
    const parsed = JSON.parse(raw) as { version?: unknown } | null
    return parsed?.version === 1 ? 1 : parsed?.version === 2 ? 2 : 'unknown'
  } catch {
    return 'unknown'
  }
}

export type ReadJournalV2FileResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'corrupt'; readonly error: string }
  | { readonly kind: 'ok'; readonly journal: RestoreJournalV2 }

/**
 * Read the on-disk journal as v2. A v1 journal, a future version, or garbage all
 * come back `corrupt` here; preboot detects the version first and dispatches a
 * recognized v1 journal to its compatibility reader. Unreadable is `corrupt`
 * too, not `none`: "absent" is a claim only ENOENT can
 * make, and every other errno must fail safe for the reclaim guard.
 */
export function readRestoreJournalV2(): ReadJournalV2FileResult {
  let raw: string
  try {
    raw = fs.readFileSync(journalFilePath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'none' }
    }
    return { kind: 'corrupt', error: String(error) }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { kind: 'corrupt', error: String(error) }
  }

  const result = parseRestoreJournalV2(parsed)
  return result.kind === 'ok' ? { kind: 'ok', journal: result.journal } : { kind: 'corrupt', error: result.error }
}

/**
 * Remove the journal, making "no restore is pending" durable.
 *
 * Idempotent: an already-absent journal is success, which is what lets
 * acknowledgement cleanup and cancellation be re-run after a crash. The parent
 * directory is fsynced on POSIX for the same reason writes are — the unlink must
 * survive power loss, or a cleared restore would come back and promote again.
 * Windows provides the narrower process-crash guarantee documented below.
 *
 * ORDERING CONTRACT (§6.5): this is the LAST step of acknowledgement. While the
 * journal exists, the recovery asides are protected; clearing it first would
 * release that protection over asides that are still on disk.
 */
export function clearRestoreJournalV2(): void {
  const journalPath = journalFilePath()
  try {
    fs.unlinkSync(journalPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return
  }

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
 * Crash-safe journal write: write-ahead to a `.tmp` sibling, fsync it, rename
 * over the journal path, then fsync the parent directory on POSIX so the rename
 * itself is durable. Windows directory handles cannot be fsynced and Node/libuv
 * rename does not request `MOVEFILE_WRITE_THROUGH`, so Windows guarantees
 * process-crash recovery only; sudden power loss may roll metadata back.
 *
 * Deliberately mirrors the v1 writer rather than sharing it: v1 disappears at
 * the promotion cutover, and coupling two on-disk contracts that are about to
 * diverge would be the wrong dependency to create for one phase of overlap.
 */
/** Narrow fault-injection seam for short-write recovery tests. */
export const restoreJournalIo: {
  writeSync(fd: number, bytes: Uint8Array, offset: number, length: number, position: number | null): number
} = {
  writeSync: (fd, bytes, offset, length, position) => fs.writeSync(fd, bytes, offset, length, position)
}

function writeBufferFully(fd: number, bytes: Buffer): void {
  let offset = 0
  while (offset < bytes.length) {
    const written = restoreJournalIo.writeSync(fd, bytes, offset, bytes.length - offset, null)
    if (written <= 0) {
      throw new Error(`restore journal write made no progress at ${offset}/${bytes.length} bytes`)
    }
    offset += written
  }
}

export function writeRestoreJournalV2(journal: RestoreJournalV2): void {
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
