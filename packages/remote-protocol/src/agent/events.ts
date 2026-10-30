import * as z from 'zod'

import { decimal, digest, opaqueId, unicodeText } from '../values'
import {
  agentCursorSchema,
  executionSchema,
  interactionSummarySchema,
  messageSchema,
  partSchema,
  sessionSchema
} from './resources'

const revision = { baseRevision: decimal, revision: decimal }
const partTarget = { messageId: opaqueId, partId: opaqueId }
const mutation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session.updated'), payload: sessionSchema }),
  z.object({ kind: z.literal('execution.updated'), payload: executionSchema }),
  z.object({ kind: z.literal('message.created'), payload: messageSchema }),
  z.object({
    kind: z.literal('message.updated'),
    payload: z.strictObject({ baseRevision: decimal, message: messageSchema })
  }),
  z.object({ kind: z.literal('message.removed'), payload: z.strictObject({ messageId: opaqueId, ...revision }) }),
  z.object({
    kind: z.literal('part.created'),
    payload: z.strictObject({
      messageId: opaqueId,
      afterPartId: opaqueId.nullable(),
      messageBaseRevision: decimal,
      messageRevision: decimal,
      part: partSchema
    })
  }),
  z.object({
    kind: z.literal('part.append'),
    payload: z.strictObject({ ...partTarget, ...revision, offsetUtf8: decimal, text: unicodeText.max(16_384) })
  }),
  z.object({
    kind: z.literal('part.replaced'),
    payload: z.strictObject({ messageId: opaqueId, baseRevision: decimal, part: partSchema })
  }),
  z.object({
    kind: z.literal('part.completed'),
    payload: z.strictObject({ ...partTarget, ...revision, byteLength: decimal, sha256: digest })
  }),
  z.object({
    kind: z.literal('part.removed'),
    payload: z.strictObject({ ...partTarget, ...revision, messageBaseRevision: decimal, messageRevision: decimal })
  }),
  z.object({ kind: z.literal('interaction.updated'), payload: interactionSummarySchema }),
  z.object({
    kind: z.literal('history.committed'),
    payload: z.strictObject({
      historyRevision: decimal,
      executionId: opaqueId.optional(),
      messages: z.array(z.strictObject({ messageId: opaqueId, revision: decimal })).max(4096)
    })
  })
])

export const agentEventSchema = z.intersection(
  z.strictObject({ seq: decimal, ...{ kind: z.string(), payload: z.unknown() } }),
  mutation
)
export const agentEventBatchSchema = z.strictObject({
  subscriptionId: opaqueId,
  sessionId: opaqueId,
  streamEpoch: opaqueId,
  events: z.array(agentEventSchema).min(1).max(1024)
})
export const agentNotificationSchema = z.union([
  z.strictObject({ jsonrpc: z.literal('2.0'), method: z.literal('agent.events'), params: agentEventBatchSchema }),
  z.strictObject({
    jsonrpc: z.literal('2.0'),
    method: z.literal('agent.subscriptions.resetRequired'),
    params: z.strictObject({
      subscriptionId: opaqueId,
      reason: z.enum(['RESET_REQUIRED', 'CHECKPOINT_EXPIRED', 'RESOURCE_EXHAUSTED'])
    })
  })
])
export const agentProjectionSchema = z.strictObject({
  cursor: agentCursorSchema,
  session: sessionSchema,
  executions: z.record(z.string(), executionSchema),
  messages: z.record(z.string(), messageSchema),
  parts: z.record(z.string(), partSchema),
  interactions: z.record(z.string(), interactionSummarySchema),
  tombstones: z.array(opaqueId).max(100_000)
})
export type AgentEvent = z.infer<typeof agentEventSchema>
export type AgentEventBatch = z.infer<typeof agentEventBatchSchema>
export type AgentProjection = z.infer<typeof agentProjectionSchema>
