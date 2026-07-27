import { portableCollisionKey, RelativeSubpathSchema } from '@main/utils/relativePath'
import * as z from 'zod'

import { MAX_RESOURCE_INSTALL_ENTRIES } from './restoreLimits'

/**
 * Restore-promotion journal v2 — the crash-safe contract for the Backup v2
 * replacement flow (docs/references/backup/README.md §6). This is a
 * SIDE-BY-SIDE contract: the v1 journal (`./restoreJournal.ts`, `version: 1`,
 * state `staged`) and its promotion code stay live and untouched until Phase 2
 * performs the cutover. Introducing v2 here as a separate module — rather than
 * mutating v1 in place — keeps the running v1 promotion/orphan-sweep path
 * whole while the v2 contract is proven by tests. There is intentionally NO
 * file I/O and NO wiring to the live journal sidecar in this module; Phase 2
 * owns reading/writing this journal to `feature.backup.restore.file`.
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
const RestoreSummarySchema = z.strictObject({
  knowledgeBaseIds: z
    .array(z.string().min(1))
    .max(MAX_RESOURCE_INSTALL_ENTRIES)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'knowledge-base IDs must be unique' })
})

const commonFields = {
  version: z.literal(RESTORE_JOURNAL_VERSION),
  /** Producer-generated UUID (the chosen restore-id contract). */
  restoreId: z.uuid(),
  preset: z.enum(['lite', 'full']),
  /** ISO-8601 timestamp, diagnostic only. */
  createdAt: z.iso.datetime(),
  db: DbPromotionSchema,
  resourceInstalls: z.array(ResourceInstallEntrySchema).max(MAX_RESOURCE_INSTALL_ENTRIES)
}

/**
 * Discriminated on `state`. `prepared`/`armed` carry no step (promotion has not
 * begun); `promoting` requires the last-completed step; terminal states may
 * keep it for diagnostics. `completed` carries the durable `summary` the
 * post-promotion reindex scheduler consumes; `failed`/`expired` carry an
 * optional terminal `reason` for post-boot reporting. `strictObject` +
 * `version: z.literal(2)` make a downgraded v1 parser reject a v2 journal (and
 * vice-versa): unknown version/fields → parse failure → the gate quarantines
 * rather than reinterprets (§5.2 strict-version quarantine).
 */
const journalVariants = [
  z.strictObject({ ...commonFields, state: z.literal('prepared') }),
  z.strictObject({ ...commonFields, state: z.literal('armed') }),
  z.strictObject({ ...commonFields, state: z.literal('promoting'), step: PromotionStepSchema }),
  z.strictObject({
    ...commonFields,
    state: z.literal('completed'),
    step: PromotionStepSchema.optional(),
    summary: RestoreSummarySchema
  }),
  z.strictObject({
    ...commonFields,
    state: z.literal('failed'),
    step: PromotionStepSchema.optional(),
    reason: z.string().min(1).optional()
  }),
  z.strictObject({
    ...commonFields,
    state: z.literal('expired'),
    step: PromotionStepSchema.optional(),
    reason: z.string().min(1).optional()
  })
] as const

/**
 * Lite carries no resource payload, so a Lite journal MUST have an empty
 * `resourceInstalls` (§2.1). Enforced as a post-union refinement because the
 * union already discriminates on `state`.
 */
export const RestoreJournalV2Schema = z
  .discriminatedUnion('state', journalVariants)
  .refine((journal) => journal.preset !== 'lite' || journal.resourceInstalls.length === 0, {
    message: 'a lite restore journal must declare no resource-install entries',
    path: ['resourceInstalls']
  })

export type RestoreJournalV2 = z.infer<typeof RestoreJournalV2Schema>
export type RestoreJournalV2State = RestoreJournalV2['state']
export type ResourceInstallEntry = z.infer<typeof ResourceInstallEntrySchema>
export type RestoreSummary = z.infer<typeof RestoreSummarySchema>

export type ReadJournalV2Result =
  | { readonly kind: 'ok'; readonly journal: RestoreJournalV2 }
  | { readonly kind: 'invalid'; readonly error: string }

/** Pure structural parse — no I/O. Phase 2 wraps file reads around this. */
export function parseRestoreJournalV2(value: unknown): ReadJournalV2Result {
  const result = RestoreJournalV2Schema.safeParse(value)
  return result.success ? { kind: 'ok', journal: result.data } : { kind: 'invalid', error: result.error.message }
}
