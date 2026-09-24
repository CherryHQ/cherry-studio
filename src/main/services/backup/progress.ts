/**
 * Progress reporting vocabulary, shared by the pipelines that emit and the
 * service that broadcasts.
 *
 * It lives here rather than beside `BackupService` because the service already
 * imports the pipelines: putting the callback type there would make every
 * pipeline import its own caller. This module imports nothing but the wire
 * type, so it stays a leaf.
 *
 * Reporting is advisory throughout. A pipeline names the stage it entered; the
 * request's own resolution is what reports the outcome, so every reporter is
 * optional and a dropped call costs a label, never correctness.
 */

import type { BackupProgressStage } from '@shared/ipc/schemas/backup'

/**
 * Names the stage a pipeline just entered. Which operation is running is bound
 * by `BackupService.runExclusive`, the one place that knows it, so callers
 * below never repeat it.
 */
export type BackupStageReporter = (stage: BackupProgressStage) => void

/**
 * A resource unit is being entered, inside a stage that walks a known set.
 *
 * Called on ENTRY, not on completion: entry is the one point every unit passes
 * through exactly once. A unit can leave its loop staged, skipped, degraded, or
 * over a ceiling — reporting at those exits would mean revisiting every one of
 * them the day a new outcome appears, and missing one would stall the count.
 */
export type BackupResourceReporter = (unit: {
  kind: string
  livePath: string
  /** 1-based position of this unit. */
  done: number
  total: number
}) => void
