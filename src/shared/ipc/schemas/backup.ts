import * as z from 'zod'

import { defineRoute } from '../define'

/** Lite archive commands. Main owns all paths through native file dialogs. */
const DegradationSchema = z.strictObject({
  code: z.enum(['capability-malformed', 'external-file-dropped', 'path-unportable', 'path-collision', 'unknown']),
  count: z.number().int().positive()
})

const RestorePreviewSchema = z.strictObject({
  restoreId: z.string().uuid(),
  degradations: z.array(DegradationSchema),
  migratedForward: z.boolean()
})

const RestoreStatusSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('unreadable') }),
  z.strictObject({
    kind: z.literal('journal'),
    state: z.enum([
      'prepared',
      'armed',
      'promoting',
      'reverting',
      'completed',
      'rollback-armed',
      'rolled-back',
      'failed',
      'expired'
    ]),
    restoreId: z.string().uuid(),
    step: z.string().optional(),
    degradations: z.array(DegradationSchema).optional()
  })
])

const BackupStatusSchema = z.strictObject({
  operation: z.enum(['export', 'prepare-restore']).nullable(),
  restore: RestoreStatusSchema
})

const AcknowledgeResultSchema = z.strictObject({
  acknowledged: z.boolean(),
  restoreId: z.string().uuid().optional(),
  removed: z.number().int().nonnegative()
})

export const backupRequestSchemas = {
  'backup.get_status': defineRoute({ input: z.void(), output: BackupStatusSchema }),
  'backup.export': defineRoute({
    input: z.void(),
    output: z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('canceled') }),
      z.strictObject({
        status: z.literal('exported'),
        archivePath: z.string(),
        degradations: z.array(DegradationSchema)
      })
    ])
  }),
  'backup.prepare_restore': defineRoute({
    input: z.void(),
    output: z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('canceled') }),
      z.strictObject({ status: z.literal('prepared'), preview: RestorePreviewSchema })
    ])
  }),
  'backup.cancel_operation': defineRoute({ input: z.void(), output: z.strictObject({ cancelled: z.boolean() }) }),
  'backup.cancel_restore': defineRoute({ input: z.void(), output: z.void() }),
  'backup.arm_restore': defineRoute({ input: z.strictObject({ restoreId: z.string().uuid() }), output: z.void() }),
  'backup.rollback_restore': defineRoute({ input: z.void(), output: z.void() }),
  'backup.acknowledge_restore': defineRoute({ input: z.void(), output: AcknowledgeResultSchema })
}
