/**
 * Restore-specific frozen limits owned by the data-layer restore module — the
 * lowest correct owner, because the journal schema here MUST enforce them and
 * `data/` cannot import upward from `services/backup`. The business-tier
 * `BACKUP_CEILINGS` re-consumes this constant so preflight/admission and the
 * journal share one source (see `services/backup/ceilings.ts`).
 *
 * Cap on `resource-install` units in one restore. Bounds preboot work and the
 * journal's `resourceInstalls` / completed-summary arrays. Upgrade trigger: a
 * real profile exceeds this limit and the preboot ceiling benchmark proves the
 * higher count remains operationally bounded.
 */
export const MAX_RESOURCE_INSTALL_ENTRIES = 50_000

/**
 * Cap on the aggregated degradation lines a journal carries for post-restore
 * reporting. The list is already folded per `(table, reason)`, so it is bounded
 * by the schema in practice; this is the hard stop that keeps a journal — the
 * one file the boot path must be able to parse — small no matter what. The
 * producer TRUNCATES to this cap rather than letting the write fail: a report
 * detail must never be able to turn a valid journal into a quarantined one.
 */
export const MAX_JOURNAL_DEGRADATIONS = 200
