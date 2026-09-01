import { AUTO_BACKUP_TYPES, type AutoBackupEvent, type AutoBackupLastSuccessTimes } from '@shared/types/backup'
import * as z from 'zod'

import { defineRoute } from '../define'

const autoBackupTypeSchema = z.enum(AUTO_BACKUP_TYPES)
// `z.record(enum, value)` in zod 4 requires every enum key, so a new AUTO_BACKUP_TYPES
// member widens this route instead of being silently stripped at the boundary while
// AutoBackupSnapshot still declares it.
const autoBackupLastSuccessTimesSchema = z.record(
  autoBackupTypeSchema,
  z.number().nullable()
) satisfies z.ZodType<AutoBackupLastSuccessTimes>
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

export const backupRequestSchemas = {
  'backup.get_auto_sync_state': defineRoute({
    input: z.void(),
    output: z.object({
      lastSuccessTimes: autoBackupLastSuccessTimesSchema,
      events: z.array(autoBackupEventSchema),
      pendingNotifications: z.array(autoBackupEventSchema)
    })
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

export type BackupEventSchemas = {
  'backup.auto_sync_state_changed': AutoBackupEvent
}
