import * as z from 'zod'

import { AbsoluteFilePathSchema } from './file'

export const workspaceUsageRecordSchema = z.strictObject({
  id: z.uuid(),
  sessionId: z.string().min(1).max(512),
  cwd: AbsoluteFilePathSchema,
  owner: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('preparation'), operationId: z.string().min(1).max(512) }),
    z.strictObject({ kind: z.literal('runtime'), contextId: z.string().min(1).max(512) }),
    z.strictObject({ kind: z.literal('terminal'), resourceId: z.uuid(), generation: z.uuid() })
  ]),
  createdAt: z.number().int().nonnegative()
})

export type WorkspaceUsageRecord = z.infer<typeof workspaceUsageRecordSchema>
