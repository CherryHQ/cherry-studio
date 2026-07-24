/**
 * Resource planning contracts — frozen up-front so the core (A1/A2) and the
 *外围 (B1-B4) workstreams can proceed in parallel.
 *
 * `ResourcePlan` is one value with three consumers (see full-restore-plan §6):
 *   - merge input   : skippedFileEntryIds / stagedFileEntryIds (drives MergeEngine)
 *   - journal source : resources (serialized into RestoreJournal.fileResources)
 *   - disclosure UI  : skips (mirrors into RestoreResultSummary.toSkip)
 *
 * Conflict policy (v2.1): every resource class skips on conflict (local DB row
 * OR disk exists), matching merge's uuid-entity SKIP. No overwrite in this PR.
 * The work.sqlite input makes planning's DB-row conflict check same-source as
 * merge SKIP (avoids existsSync-only divergence → orphan blob / mixed entity).
 */

import type { BackupManifest } from './manifest'
import type { FileResource } from '@main/data/db/restore/restoreJournal'

/** Resource class for planning + skip disclosure. */
export type ResourceClass = 'file' | 'knowledge' | 'skill' | 'note'

/**
 * A resource the plan skipped (conflict / managed-only / etc). 1:1 source for
 * the relaunch-result disclosure UI (RestoreResultSummary.toSkip).
 */
export interface SkippedResource {
  readonly id: string
  readonly kind: ResourceClass
  readonly reason: string
}

/**
 * Output of resource planning (runs before merge, full-restore-plan §5 段1).
 *
 * Conflict: every class skips on conflict (local DB row OR disk exists),
 * matching merge's uuid-entity SKIP — no overwrite in this PR.
 */
export interface ResourcePlan {
  /** file_entry ids whose blob will be staged → merge discloses soft-refs correctly. */
  readonly stagedFileEntryIds: Set<string>
  /** file_entry ids skipped (conflict/external/pruned) → merge does NOT import the row (no dangling). */
  readonly skippedFileEntryIds: Set<string>
  /** File resources to apply at preboot promotion (all `*-add` kinds; no overwrite). */
  readonly resources: FileResource[]
  /** Skipped resources with reason → relaunch-result disclosure UI. */
  readonly skips: SkippedResource[]
}

/**
 * Roots planning resolves livePaths against + containment-checks. notesRoot is a
 * resolver (preference-driven; may point outside userData → its notes skip).
 */
export interface PlanRoots {
  readonly files: string
  readonly knowledge: string
  readonly skills: string
  readonly notes: () => string | undefined
}

/**
 * Input to planResources. `workPath` is the post-snapshot local-state
 * work.sqlite — planning's DB-row conflict check reads it so the decision is
 * same-source as merge SKIP (snapshot happens before planning, §5 时序).
 */
export interface PlanCtx {
  readonly manifest: BackupManifest
  readonly workDir: string
  readonly backupDbPath: string
  readonly workPath: string
  readonly userData: string
  readonly roots: PlanRoots
}
