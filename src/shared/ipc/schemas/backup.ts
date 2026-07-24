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
//   - backup.progress (event): per-step progress ticks during the export.
//
// The `note` overlay rows + DB copy travel in both presets; Notes markdown bodies +
// file blobs are full-preset file resources (orchestrator-enforced, not a route concern).

import type { BackupProgressUpdate } from '@shared/types/backup'
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
  })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type BackupEventSchemas = {
  // Per-step export progress tick (phase: collect/snapshot/archive, current/total, msg).
  // Emitted via IpcApiService.broadcast to all windows; backupId is the cancel key.
  'backup.progress': BackupProgressUpdate
}
