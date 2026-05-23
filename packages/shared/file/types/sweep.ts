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
 * - `'completed'` — sweep ran end-to-end. Counts are authoritative.
 * - `'partial'` — at least one per-sourceType checker threw; `errorsByType`
 *   identifies which. Counts cover the sourceTypes that did report; UI
 *   should surface the partial state so users don't read zero-orphans as
 *   a healthy signal.
 * - `'failed'` — the sweep collapsed before per-type aggregation. Counts
 *   are all zero (and meaningless); `errorMessage` carries the cause.
 *
 * Without the `outcome` discriminator, a `failed` run reaches the renderer
 * as `{ orphanRefsTotal: 0, …, lastRunAt }` — indistinguishable from a
 * happy zero, and the cleanup dashboard would render "all clear" while
 * sourceType checkers were silently crashing. The discriminator forces
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
      readonly lastRunAt: number
    })
  | (OrphanReportCounts & {
      readonly outcome: 'failed'
      readonly errorMessage: string
      readonly lastRunAt: number
    })
