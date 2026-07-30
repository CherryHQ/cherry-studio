import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { fsyncDirectorySync, renameOnlySync, unlinkAndFsyncParentSync, writeFileFullySync } from '@main/utils/file'
import { portableCollisionKey, RelativeSubpathSchema } from '@main/utils/relativePath'
import * as z from 'zod'

import { MAX_JOURNAL_DEGRADATIONS, MAX_RESOURCE_INSTALL_ENTRIES } from './restoreLimits'

const logger = loggerService.withContext('RestoreJournalV2')

/**
 * Restore-promotion journal v2 — the crash-safe contract for the Backup v2
 * replacement flow (docs/references/backup/README.md §6). It is the only
 * active journal writer. The preboot shell recognizes a leftover version-1
 * sidecar only to park it as pre-release recovery evidence; no runtime path
 * creates or promotes that retired format.
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
 *
 * `hadLive` records whether the target existed when the plan was sealed, and it
 * is what makes the aside's ABSENCE readable. Without it, "live present, nothing
 * staged, no aside" has two readings — the target was originally absent (so the
 * node in `live` is the archive's, remove it) or the aside that held the user's
 * original is gone (so removing `live` destroys the only copy left) — and the
 * recovery table had to guess the first. Optional only for journals written by
 * an earlier pre-release: every writer since must supply it (see
 * {@link SealedResourceInstallEntry}), and readers treat its absence as "cannot
 * prove", never as `false`.
 */
const ResourceInstallEntrySchema = z
  .strictObject({
    resourceType: z.enum(['file', 'directory']),
    staging: RelativeSubpathSchema,
    live: RelativeSubpathSchema,
    aside: RelativeSubpathSchema,
    hadLive: z.boolean().optional()
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

/** Pre-release completion summary retained only so already-written v2 journals remain readable. */
const uniqueKnowledgeBaseIds = z
  .array(z.string().min(1))
  .max(MAX_RESOURCE_INSTALL_ENTRIES)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'knowledge-base IDs must be unique'
  })

const RestoreSummarySchema = z.strictObject({
  knowledgeBaseIds: uniqueKnowledgeBaseIds
})

/**
 * Feature-owned readiness data transported opaquely through preboot.
 *
 * The data layer validates only that it is JSON. Business keys and their
 * schemas belong to the owners that produce and consume them.
 */
const RestoreOwnerSummarySchema = z.record(z.string().min(1), z.json())

/** Feature-owned progress transported opaquely through preboot and rollback. */
const RestoreOwnerProgressSchema = z.record(z.string().min(1), z.json())

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
   * Sealed before staging is moved. Optional on the read side for v2 journals
   * written by an earlier pre-release; every current producer supplies it.
   */
  ownerSummary: RestoreOwnerSummarySchema.optional(),
  /**
   * Durable per-owner progress. The data layer validates only JSON structure;
   * owner keys, schemas, and consistency with `ownerSummary` remain business
   * policy and are interpreted after lifecycle startup.
   */
  ownerProgress: RestoreOwnerProgressSchema.optional(),
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
    /** Pre-release field; new journals use `ownerSummary`. */
    summary: RestoreSummarySchema.optional(),
    /**
     * The database is live, but a resource unit did not reach its installed
     * state — so somewhere on disk a unit's only remaining copies are its
     * staging source and its aside. `completed` alone would let acknowledgement
     * delete both and leave that unit with nothing (§6.5). Absent means every
     * unit is installed; `true` is the only other value.
     */
    resourcesIncomplete: z.literal(true).optional(),
    /** @deprecated Pre-release compatibility only. New journals use `ownerProgress`. */
    knowledgeRebuild: z.json().optional()
  }),
  z.strictObject({
    ...commonFields,
    state: z.literal('rollback-armed'),
    step: PromotionStepSchema.optional(),
    summary: RestoreSummarySchema.optional(),
    /** @deprecated Pre-release compatibility only. New journals use `ownerProgress`. */
    knowledgeRebuild: z.json().optional()
  }),
  z.strictObject({
    ...commonFields,
    state: z.literal('rolled-back'),
    step: PromotionStepSchema.optional(),
    summary: RestoreSummarySchema.optional(),
    /** @deprecated Pre-release compatibility only. New journals use `ownerProgress`. */
    knowledgeRebuild: z.json().optional()
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
      (journal.state !== 'completed' && journal.state !== 'rollback-armed' && journal.state !== 'rolled-back') ||
      journal.ownerSummary !== undefined ||
      journal.summary !== undefined,
    {
      message: 'a committed restore must carry owner readiness state',
      path: ['ownerSummary']
    }
  )

export type RestoreJournalV2 = z.infer<typeof RestoreJournalV2Schema>
export type RestoreJournalV2State = RestoreJournalV2['state']
export type ResourceInstallEntry = z.infer<typeof ResourceInstallEntrySchema>
/**
 * What a producer must seal: `hadLive` is optional on the READ side only, so the
 * type every planner and journal writer flows through makes it mandatory. An
 * entry that reaches the disk without it disables rollback for the whole restore.
 */
export type SealedResourceInstallEntry = ResourceInstallEntry & { readonly hadLive: boolean }
export type JournalDegradation = z.infer<typeof JournalDegradationSchema>
export type RestoreOwnerSummary = z.infer<typeof RestoreOwnerSummarySchema>
export type RestoreOwnerProgress = z.infer<typeof RestoreOwnerProgressSchema>
/** @deprecated Pre-release compatibility only. New journals use {@link RestoreOwnerSummary}. */
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
  const userData = application.getPath('app.userdata')
  const dbDir = path.dirname(application.getPath('app.database.file'))
  return path
    .relative(userData, path.join(dbDir, `${dbAsidePrefix()}${restoreId}`))
    .split(path.sep)
    .join('/')
}

/**
 * The one tree this restore's resource park slots live in — the resource-side
 * counterpart to {@link dbAsideRelPathV2}, and here for the same reason:
 * preparation fills those slots while acknowledgement releases them, and only
 * one of the two may define where they are.
 *
 * The root segment is read back from the path registry rather than written out,
 * so the tree has exactly one definition (src/main/core/paths/README.md). Only
 * its basename is used: everything below here is userData-relative on purpose,
 * so relocating the profile cannot strand a plan (§6.6).
 */
export function resourceAsideRootRelPathV2(restoreId: string): string {
  return `${path.basename(application.getPath('feature.backup.restore.aside'))}/${restoreId}`
}

/**
 * Where a post-commit revert parks the rejected database, named per restore and
 * owned here for the same reason as {@link dbAsideRelPathV2}: the promotion that
 * creates it and the acknowledgement that releases it are in different modules,
 * and only one of them may define the name.
 *
 * It sits beside the live database rather than in a restore-owned tree: the
 * restore that would have cleaned it up is the one that failed, so its last
 * sweeper is a data reset — and a reset clears the database's own directory.
 */
export function parkedFailedDbRelPathV2(restoreId: string): string {
  const userData = application.getPath('app.userdata')
  const dbDir = path.dirname(application.getPath('app.database.file'))
  return path.relative(userData, path.join(dbDir, `restore-failed-${restoreId}.sqlite`))
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

/**
 * WHY the journal could not be read, as a closed set.
 *
 * The underlying errno string and the schema's own report name the journal's
 * absolute path and quote its contents, and this result travels all the way to a
 * status the renderer receives. The reason is what a caller can act on; the
 * detail is logged here, once, where it is still diagnostic.
 */
export type JournalReadFailure =
  /** The file exists but could not be read (permissions, I/O, a directory in its place). */
  | 'unreadable-file'
  /** The bytes are not JSON at all. */
  | 'invalid-json'
  /** Valid JSON that no v2 journal shape accepts — including a v1 or a future-version journal. */
  | 'invalid-shape'

export type ReadJournalV2FileResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'corrupt'; readonly reason: JournalReadFailure }
  | { readonly kind: 'ok'; readonly journal: RestoreJournalV2 }

/**
 * Read the on-disk journal as v2. A v1 journal, a future version, or garbage all
 * come back `corrupt` here; preboot detects and parks a recognized v1 sidecar
 * before calling this reader. Unreadable is `corrupt` too, not `none`:
 * "absent" is a claim only ENOENT can make, and every other errno must fail
 * safe for the reclaim guard.
 */
export function readRestoreJournalV2(): ReadJournalV2FileResult {
  let raw: string
  try {
    raw = fs.readFileSync(journalFilePath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'none' }
    }
    return corrupt('unreadable-file', String(error))
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return corrupt('invalid-json', String(error))
  }

  const result = parseRestoreJournalV2(parsed)
  return result.kind === 'ok' ? { kind: 'ok', journal: result.journal } : corrupt('invalid-shape', result.error)
}

/** Keep the detail where it is useful — the main log — and pass on only the reason. */
function corrupt(reason: JournalReadFailure, detail: string): ReadJournalV2FileResult {
  logger.error('Restore journal could not be read', { reason, detail })
  return { kind: 'corrupt', reason }
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
  unlinkAndFsyncParentSync(journalFilePath())
}

/**
 * Crash-safe journal write: write-ahead to a `.tmp` sibling, fsync it, rename
 * over the journal path, then fsync the parent directory on POSIX so the rename
 * itself is durable. Windows directory handles cannot be fsynced and Node/libuv
 * rename does not request `MOVEFILE_WRITE_THROUGH`, so Windows guarantees
 * process-crash recovery only; sudden power loss may roll metadata back.
 *
 * The byte-write/fsync/rename primitives are shared filesystem mechanics; the
 * tmp name, serialized shape, and ordering remain this journal's contract.
 */
export function writeRestoreJournalV2(journal: RestoreJournalV2): void {
  const journalPath = journalFilePath()
  const tmpPath = `${journalPath}.tmp`
  const bytes = Buffer.from(JSON.stringify(journal, null, 2), 'utf8')

  try {
    writeFileFullySync(tmpPath, bytes)
    renameOnlySync(tmpPath, journalPath)
    fsyncDirectorySync(path.dirname(journalPath))
  } catch (error) {
    try {
      fs.unlinkSync(tmpPath)
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Could not remove failed restore journal temporary file', cleanupError as Error)
      }
    }
    throw error
  }
}
