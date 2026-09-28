import * as z from 'zod'

import { encodeCanonical } from '../encoding'
import { decimal, digest, opaqueId, timestamp } from '../values'
import {
  agentCursorSchema,
  executionSchema,
  interactionSummarySchema,
  messageSchema,
  partSchema,
  sessionSchema
} from './resources'

export const checkpointItemSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('session'), value: sessionSchema }),
  z.strictObject({ kind: z.literal('execution'), value: executionSchema }),
  z.strictObject({ kind: z.literal('message'), value: messageSchema }),
  z.strictObject({ kind: z.literal('part'), messageId: opaqueId, value: partSchema }),
  z.strictObject({ kind: z.literal('interaction'), value: interactionSummarySchema })
])
export const agentCheckpointDescriptorSchema = z.looseObject({
  checkpointId: opaqueId,
  cursor: agentCursorSchema,
  historyRevision: decimal,
  pageCount: z.number().int().min(1).max(100_000),
  byteLength: decimal,
  sha256: digest,
  expiresAt: timestamp
})
export const agentCheckpointPageSchema = z.looseObject({
  checkpointId: opaqueId,
  pageIndex: z.number().int().nonnegative(),
  items: z.array(checkpointItemSchema).max(100),
  nextCursor: opaqueId.nullable(),
  pageDigest: digest
})
export type AgentCheckpointDescriptor = z.infer<typeof agentCheckpointDescriptorSchema>
export type AgentCheckpointPage = z.infer<typeof agentCheckpointPageSchema>

export function encodeAgentCheckpointPage(page: AgentCheckpointPage): Uint8Array {
  const parsed = agentCheckpointPageSchema.parse(page)
  return encodeCanonical({
    checkpointId: parsed.checkpointId,
    pageIndex: parsed.pageIndex,
    items: parsed.items,
    nextCursor: parsed.nextCursor
  })
}
