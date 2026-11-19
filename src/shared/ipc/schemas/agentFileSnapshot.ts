import * as z from 'zod'

import { defineRoute } from '../define'

const identifier = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value !== '.' && value !== '..' && !/[\\/\0]/.test(value))
export const agentFileSnapshotReason = z.enum([
  'empty-write',
  'large-deletion',
  'undecidable',
  'snapshot-failed',
  'SNAPSHOT_ROOT_IN_WORKSPACE',
  'turn-active',
  'stale',
  'unverifiable',
  'conflict',
  'pending',
  'no-round',
  'empty',
  'failed',
  'unknown',
  'restored',
  'round-mismatch',
  'revision-mismatch',
  'partial',
  'approval-unavailable',
  'approval-denied',
  'invalid-path',
  'outside-workspace'
])
export type AgentFileSnapshotReason = z.infer<typeof agentFileSnapshotReason>

const file = z.strictObject({
  path: z.string(),
  status: z.enum(['changed', 'already-restored', 'unknown', 'conflict'])
})

export const agentFileSnapshotRequestSchemas = {
  'agent.file_snapshot.state': defineRoute({
    input: z.strictObject({ sessionId: identifier }),
    output: z.strictObject({
      replyId: identifier.nullable(),
      revision: z.string().nullable(),
      canUndo: z.boolean(),
      reason: agentFileSnapshotReason.nullable(),
      files: z.array(file)
    })
  }),
  'agent.file_snapshot.undo': defineRoute({
    input: z.strictObject({ sessionId: identifier, replyId: identifier, expectedRevision: z.string().min(1).max(200) }),
    output: z.strictObject({
      reason: agentFileSnapshotReason.nullable(),
      files: z.array(
        z.strictObject({ path: z.string(), status: z.string(), reason: z.literal('unverifiable').optional() })
      )
    })
  })
}
