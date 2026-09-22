import * as z from 'zod'

import { remoteFailureSchema } from '../errors'
import { decimal, digest, opaqueId, timestamp, unicodeText } from '../values'

export const agentAuthorizationSchema = z.looseObject({ domain: z.literal('agent'), grantId: opaqueId })
export const agentCursorSchema = z.strictObject({ sessionId: opaqueId, streamEpoch: opaqueId, seq: decimal })
export const contentRefSchema = z.strictObject({
  contentId: opaqueId,
  revision: decimal,
  byteLength: decimal,
  mediaType: z.string().min(1).max(128),
  sha256: digest
})
export const sessionSchema = z.looseObject({
  sessionId: opaqueId,
  agentId: opaqueId,
  workspaceId: opaqueId,
  title: unicodeText.max(4096),
  updatedAt: timestamp,
  historyRevision: decimal,
  activeExecutionId: opaqueId.optional(),
  idleRevision: decimal.optional()
})
export const executionSchema = z.looseObject({
  executionId: opaqueId,
  status: z.enum(['running', 'awaiting-approval', 'finalizing', 'completed', 'cancelled', 'failed', 'interrupted']),
  commandId: opaqueId.optional(),
  messageId: opaqueId.optional(),
  error: remoteFailureSchema.optional(),
  durable: z.boolean()
})
export const messageSchema = z.looseObject({
  messageId: opaqueId,
  revision: decimal,
  role: z.enum(['user', 'assistant', 'system']),
  partIds: z.array(opaqueId).max(4096)
})
const partBase = {
  partId: opaqueId,
  revision: decimal,
  executionId: opaqueId.optional(),
  toolCallId: opaqueId.optional()
}
const content = z.union([z.strictObject({ text: unicodeText.max(65_536) }), z.strictObject({ ref: contentRefSchema })])
export const partSchema = z.discriminatedUnion('kind', [
  z.looseObject({ ...partBase, kind: z.literal('text'), content, state: z.enum(['streaming', 'completed']) }),
  z.looseObject({ ...partBase, kind: z.literal('reasoning'), content, state: z.enum(['streaming', 'completed']) }),
  z.looseObject({
    ...partBase,
    kind: z.literal('tool-input'),
    toolName: opaqueId,
    content,
    state: z.enum(['streaming', 'completed'])
  }),
  z.looseObject({
    ...partBase,
    kind: z.literal('tool-output'),
    toolName: opaqueId,
    content,
    state: z.enum(['completed', 'failed'])
  }),
  z.looseObject({ ...partBase, kind: z.literal('file'), name: unicodeText.max(1024), ref: contentRefSchema }),
  z.looseObject({ ...partBase, kind: z.literal('data'), name: opaqueId, content })
])
export const interactionSummarySchema = z.looseObject({
  interactionId: opaqueId,
  revision: decimal,
  executionId: opaqueId,
  toolCallId: opaqueId,
  status: z.enum(['pending', 'approved', 'denied', 'expired']),
  summary: unicodeText.max(2048),
  inputDigest: digest,
  expiresAt: timestamp.optional()
})
export const interactionSchema = interactionSummarySchema.extend({ input: content })
export const commandReceiptSchema = z.looseObject({
  commandId: opaqueId,
  method: opaqueId,
  status: z.enum(['accepted', 'applied', 'rejected', 'interrupted']),
  admittedAt: timestamp,
  sessionId: opaqueId.optional(),
  executionId: opaqueId.optional(),
  result: z.json().optional(),
  error: remoteFailureSchema.optional()
})
export type AgentAuthorization = z.infer<typeof agentAuthorizationSchema>
export type AgentCursor = z.infer<typeof agentCursorSchema>
export type AgentSession = z.infer<typeof sessionSchema>
export type AgentMessage = z.infer<typeof messageSchema>
export type AgentPart = z.infer<typeof partSchema>
export type AgentExecution = z.infer<typeof executionSchema>
export type AgentInteraction = z.infer<typeof interactionSchema>
export type ContentRef = z.infer<typeof contentRefSchema>
export type CommandReceipt = z.infer<typeof commandReceiptSchema>
