// Backup IPC schemas — v2 modular backup export pipeline + v1 auto-backup events.
//
// Two blocks per the framework's two-axis model (see ipc-overview.md):
//   - Request schemas are zod *values* (renderer→main, untrusted → always parsed).
//   - Event schemas are pure *types* (main→renderer, main is the TCB → not parsed).
//
// v2 routes:
//   - backup.start_backup: kick off a .cherrybackup export (full/lite preset → output path).
//     Returns the backupId (cancel/progress routing key) + final archive path.
//   - backup.cancel: abort the active export whose id matches backupId (no-op if no
//     match or idle). The orchestrator checks the AbortSignal at the next step boundary.
//   - backup.restore_relaunch: relaunch only a sealed, staged restore journal.
//   - backup.restore_status: read the restore journal's current outcome (post-relaunch disclosure).
//   - backup.restore_acknowledge: user has seen a terminal outcome → clear the journal.
//   - backup.progress (event): per-step progress ticks during the export.
//   - backup.restore_summary (event): pre-relaunch restore disclosure (will restore / will skip).
// v1 auto-backup routes (main):
//   - backup.get_auto_sync_state / acknowledge_auto_sync_notification / manual_completion.record
//   - backup.auto_sync_state_changed (event)
//
// The `note` overlay rows + DB copy travel in both presets; Notes markdown bodies +
// file blobs are full-preset file resources (orchestrator-enforced, not a route concern).

import {
  AUTO_BACKUP_TYPES,
  type AutoBackupEvent,
  type BackupProgressUpdate,
  type RestoreResultSummary,
  RestoreResultSummarySchema,
  type RestoreStatus
} from '@shared/types/backup'
import * as z from 'zod'

import { defineRoute } from '../define'

const restoreStatusSchema: z.ZodType<RestoreStatus> = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('none') }),
  z.strictObject({ state: z.literal('pending'), summary: RestoreResultSummarySchema.optional() }),
  z.strictObject({ state: z.literal('completed'), summary: RestoreResultSummarySchema.optional() }),
  z.strictObject({ state: z.literal('failed'), reason: z.string().optional() }),
  z.strictObject({ state: z.literal('expired'), reason: z.string().optional() })
])

const autoBackupTypeSchema = z.enum(AUTO_BACKUP_TYPES)
const eventFields = { id: z.number().int().positive(), type: autoBackupTypeSchema }
const autoBackupEventSchema = z.discriminatedUnion('status', [
  z.object({ ...eventFields, status: z.literal('running') }),
  z.object({ ...eventFields, status: z.literal('stopped') }),
  z.object({ ...eventFields, status: z.literal('succeeded'), timestamp: z.number() }),
  z.object({
    ...eventFields,
    status: z.literal('warning'),
    timestamp: z.number(),
    reason: z.literal('cleanup_failed')
  }),
  z.object({ ...eventFields, status: z.literal('failed'), timestamp: z.number(), errorMessage: z.string() })
])

// ── Request: renderer→main calls (zod values, always parsed) ──
export const backupRequestSchemas = {
  // v2 modular export/restore pipeline.
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
  // The restore service verifies the journal is sealed and still staged before
  // relaunching, so this capability cannot restart the app outside that transition.
  'backup.restore_relaunch': defineRoute({ input: z.void(), output: z.void() }),
  // Post-relaunch outcome disclosure: the promotion result lives in the restore
  // journal (terminal journals are kept until acknowledged), so the UI queries
  // it on open and clears it once the user has seen the outcome.
  'backup.restore_status': defineRoute({
    input: z.void(),
    output: restoreStatusSchema
  }),
  'backup.restore_acknowledge': defineRoute({
    input: z.void(),
    output: z.object({ cleared: z.boolean() })
  }),
  // v1 auto-backup sync state (webdav/s3/local/nutstore).
  'backup.get_auto_sync_state': defineRoute({
    input: z.void(),
    output: z.object({ events: z.array(autoBackupEventSchema), pendingNotifications: z.array(autoBackupEventSchema) })
  }),
  'backup.acknowledge_auto_sync_notification': defineRoute({
    input: z.object({ type: autoBackupTypeSchema, id: z.number().int().positive() }),
    output: z.void()
  }),
  'backup.manual_completion.record': defineRoute({
    input: z.object({ type: autoBackupTypeSchema }),
    output: z.void()
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
  // renderer's confirm dialog owns the restart via backup.restore_relaunch, so a broadcast
  // followed by an unconditional relaunch would leave no window to read or click.
  // Quiesce + BACKUP_IN_PROGRESS must stay held while the dialog is up (writes during
  // disclosure raise whole-batch clean-expire risk at the preboot gate). Promotion has
  // not applied yet, so consumers must render future-tense copy.
  'backup.restore_summary': RestoreResultSummary
  // v1 auto-backup sync state change event.
  'backup.auto_sync_state_changed': AutoBackupEvent
}
