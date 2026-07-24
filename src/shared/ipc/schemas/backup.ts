// Backup IPC schemas — v2 modular backup export pipeline.
//
// Two blocks per the framework's two-axis model (see ipc-overview.md):
//   - Request schemas are zod *values* (renderer→main, untrusted → always parsed).
//   - Event schemas are pure *types* (main→renderer, main is the TCB → not parsed).
//
// Routes:
//   - backup.start_backup: kick off a .cherrybackup export (full/lite preset → output path).
//     Returns the backupId (cancel/progress routing key) + final archive path.
//   - backup.cancel: abort the active export whose id matches backupId (no-op if no
//     match or idle). The orchestrator checks the AbortSignal at the next step boundary.
//   - backup.restore_status: read the restore journal's current outcome (post-relaunch disclosure).
//   - backup.restore_acknowledge: user has seen a terminal outcome → clear the journal.
//   - backup.progress (event): per-step progress ticks during the export.
//   - backup.restore_summary (event): pre-relaunch restore disclosure (will restore / will skip).
//
// The `note` overlay rows + DB copy travel in both presets; Notes markdown bodies +
// file blobs are full-preset file resources (orchestrator-enforced, not a route concern).

import type { BackupProgressUpdate, RestoreResultSummary } from '@shared/types/backup'
import * as z from 'zod'

import { defineRoute } from '../define'

// ── Request: renderer→main calls (zod values, always parsed) ──
export const backupRequestSchemas = {
  'backup.start_backup': defineRoute({
    input: z.strictObject({
      preset: z.enum(['full', 'lite']),
      outputPath: z.string().trim().min(1),
      overwrite: z.boolean().optional()
    }),
    output: z.object({ backupId: z.string(), archivePath: z.string() })
  }),
  'backup.cancel': defineRoute({
    input: z.strictObject({ backupId: z.string().trim().min(1) }),
    output: z.object({ cancelled: z.boolean() })
  }),
  'backup.start_restore': defineRoute({
    input: z.strictObject({ archivePath: z.string().trim().min(1) }),
    output: z.object({ restoreId: z.string() })
  }),
  // Post-relaunch outcome disclosure: the promotion result lives in the restore
  // journal (terminal journals are kept until acknowledged), so the UI queries
  // it on open and clears it once the user has seen the outcome.
  'backup.restore_status': defineRoute({
    input: z.void(),
    output: z.object({
      state: z.enum(['none', 'pending', 'completed', 'failed', 'expired']),
      reason: z.string().optional()
    })
  }),
  'backup.restore_acknowledge': defineRoute({
    input: z.void(),
    output: z.object({ cleared: z.boolean() })
  })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type BackupEventSchemas = {
  // Per-step export progress tick (phase: collect/snapshot/archive, current/total, msg).
  // Emitted via IpcApiService.broadcast to all windows; backupId is the cancel key.
  'backup.progress': BackupProgressUpdate
  // Restore disclosure summary (full-restore-plan §5/§10.5): what the staged journal
  // will restore / will skip and why. Integration contract with the spine (A2):
  // startRestore broadcasts this after seal INSTEAD of auto-relaunching — the
  // renderer's confirm dialog owns the restart via app.relaunch, so a broadcast
  // followed by an unconditional relaunch would leave no window to read or click.
  // Quiesce + BACKUP_IN_PROGRESS must stay held while the dialog is up (writes during
  // disclosure raise whole-batch clean-expire risk at the preboot gate). Promotion has
  // not applied yet, so consumers must render future-tense copy.
  'backup.restore_summary': RestoreResultSummary
}
