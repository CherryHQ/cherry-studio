/**
 * Orphan-sweep wire types — shared between the main-process implementation
 * (`src/main/services/file/internal/orphanSweep.ts`) and the renderer-side
 * cleanup-UI consumer that calls the `File_RunSweep` IPC channel.
 *
 * Living in shared so the FileIpcApi interface can name `OrphanReport`
 * without crossing the main / renderer boundary.
 */

import type { FileEntryOrigin, FileRefSourceType } from '@shared/data/types/file'

/** Counts shared across every `OrphanReport` variant — the "what was seen" portion. */
export interface OrphanReportCounts {
  readonly orphanRefsByType: Partial<Record<FileRefSourceType, number>>
  readonly orphanRefsTotal: number
  readonly orphanEntriesByOrigin: Partial<Record<FileEntryOrigin, number>>
  readonly orphanEntriesTotal: number
  readonly entryCleanup: EntryCleanupSummary
}

/**
 * Public shape returned by `FileManager.runSweep()` and consumed by the
 * cleanup UI through the `File_RunSweep` IPC channel. Keeps the wire surface
 * narrower than the full internal `DbSweepReport` (e.g. omits
 * `scanDurationMs`) while preserving the `outcome` discriminator so a
 * `partial` / `failed` run is distinguishable from a clean `completed` run
 * with zero orphans.
 *
 * Discriminated on `outcome`:
 *
 * - `'completed'` — both the DB sweep and the FS sweep ran end-to-end.
 *   Counts are authoritative.
 * - `'partial'` — at least one of these is true:
 *     - the DB sweep returned a non-fatal partial report (reserved for
 *       compatibility; current DB sweep returns only `completed` / `failed`)
 *     - the FS sweep returned a non-`'completed'` outcome (partial unlink
 *       failures / aborted by safety threshold / collapsed early) →
 *       `fsSweepIssue` carries a short description
 *   Either way, counts cover the parts that did report; UI should surface
 *   the partial state so users don't read zero-orphans as a healthy signal.
 * - `'aborted'` — the sweep deliberately stood aside because a staged
 *   backup restore is pending promotion (`abortReason: 'pending-restore'`).
 *   Nothing was scanned or deleted; counts are all zero. Distinct from
 *   `'partial'` on purpose: standing aside is expected behavior, not a
 *   degraded run the user should worry about.
 * - `'failed'` — the **DB** sweep collapsed before per-type aggregation.
 *   Counts are all zero (and meaningless); `errorMessage` carries the
 *   cause. (FS-sweep collapse alone degrades to `'partial'`, not
 *   `'failed'`, because DB counts may still be authoritative.)
 *
 * Without the `outcome` discriminator, a `failed` run reaches the renderer
 * as `{ orphanRefsTotal: 0, …, lastRunAt }` — indistinguishable from a
 * happy zero, and the cleanup dashboard would render "all clear" while
 * sweep branches were silently crashing. The discriminator forces
 * the caller to acknowledge the state.
 */
export type OrphanReport =
  | (OrphanReportCounts & {
      readonly outcome: 'completed'
      readonly lastRunAt: number
    })
  | (OrphanReportCounts & {
      readonly outcome: 'partial'
      readonly errorsByType: Partial<Record<FileRefSourceType, string>>
      /**
       * Set when the FS sweep degraded the umbrella outcome to `'partial'`
       * (the FS sweep itself returned `'partial'` / `'aborted'` / `'failed'`,
       * or threw before producing a report). Absent when the partial state
       * is driven purely by a DB-side partial report.
       */
      readonly fsSweepIssue?: string
      readonly lastRunAt: number
    })
  | (OrphanReportCounts & {
      readonly outcome: 'aborted'
      readonly abortReason: 'pending-restore'
      readonly lastRunAt: number
    })
  | (OrphanReportCounts & {
      readonly outcome: 'failed'
      readonly errorMessage: string
      readonly lastRunAt: number
    })

/**
 * Narrow wire summary of an `EntryCleanupReport` (`internal/entryCleanup.ts`)
 * for consumers that only need the headline numbers, not the full internal
 * breakdown (skipped-temp-refs / skipped-refs-reappeared / unlink-failure
 * counts, timing).
 *
 * **Consumers MUST check `outcome` independently of the umbrella `OrphanReport.outcome`.**
 * `runSweep` folds this in as `counts.entryCleanup` but never lets a `failed`
 * cleanup change the umbrella outcome — so a caller that only inspects the
 * top-level `outcome === 'completed'` would treat a crashed cleanup pass as
 * "all cleaned up". Read `entryCleanup.outcome` to surface that.
 *
 * Discriminated on `outcome` (mirrors `OrphanReport`). There is no `aborted`
 * outcome: the cleanup pass has no volume abort (spec §5.3).
 */
export type EntryCleanupSummary =
  | { readonly outcome: 'completed'; readonly candidates: number; readonly deleted: number }
  | { readonly outcome: 'failed'; readonly candidates: number; readonly deleted: number }
