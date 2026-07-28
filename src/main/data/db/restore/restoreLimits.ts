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
 * reporting. The producer compacts raw detail into one summary plus bounded
 * path samples per presentation code, so it is far below this cap in practice;
 * this hard stop still keeps the boot-critical journal small no matter what.
 */
export const MAX_JOURNAL_DEGRADATIONS = 200
