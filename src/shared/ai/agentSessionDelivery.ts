import * as z from 'zod'

export const AgentSessionDeliveryStatusSchema = z.enum(['accepted', 'delivering', 'consumed', 'failed'])
export type AgentSessionDeliveryStatus = z.infer<typeof AgentSessionDeliveryStatusSchema>

export const AgentSessionDeliveryIdentitySchema = z.strictObject({
  agentId: z.string().min(1),
  sessionId: z.string().min(1)
})
export type AgentSessionDeliveryIdentity = z.infer<typeof AgentSessionDeliveryIdentitySchema>

export const AgentSessionDeliverySnapshotSchema = z.strictObject({
  agentName: z.string(),
  sessionName: z.string()
})
export type AgentSessionDeliverySnapshot = z.infer<typeof AgentSessionDeliverySnapshotSchema>

export const AgentSessionDeliveryErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1)
})
export type AgentSessionDeliveryError = z.infer<typeof AgentSessionDeliveryErrorSchema>

export const AgentSessionDeliveryReplyPolicySchema = z.enum(['none', 'completion'])
export type AgentSessionDeliveryReplyPolicy = z.infer<typeof AgentSessionDeliveryReplyPolicySchema>

export const AgentSessionDeliveryOutcomeSchema = z.enum(['success', 'failed', 'interrupted'])
export type AgentSessionDeliveryOutcome = z.infer<typeof AgentSessionDeliveryOutcomeSchema>

/** Main-authored immutable routing plus current single-row lifecycle details. */
export const AgentSessionDeliveryEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  sender: AgentSessionDeliveryIdentitySchema,
  receiver: AgentSessionDeliveryIdentitySchema,
  senderSnapshot: AgentSessionDeliverySnapshotSchema.optional(),
  receiverSnapshot: AgentSessionDeliverySnapshotSchema.optional(),
  replyPolicy: AgentSessionDeliveryReplyPolicySchema,
  sourceMessageId: z.string().nullable(),
  outcome: AgentSessionDeliveryOutcomeSchema.nullable(),
  error: AgentSessionDeliveryErrorSchema.nullable(),
  statusAt: z.iso.datetime()
})
export type AgentSessionDeliveryEnvelope = z.infer<typeof AgentSessionDeliveryEnvelopeSchema>

/** Entity projection: indexed columns are folded back into the trusted envelope for consumers. */
export const AgentSessionDeliverySchema = AgentSessionDeliveryEnvelopeSchema.extend({
  status: AgentSessionDeliveryStatusSchema,
  inReplyTo: z.string().nullable(),
  turnRef: z.string().nullable()
})
export type AgentSessionDelivery = z.infer<typeof AgentSessionDeliverySchema>

export const SESSION_LIST_TOOL_NAME = 'session_list'
export const SESSION_READ_TOOL_NAME = 'session_read'
export const SESSION_SEARCH_TOOL_NAME = 'session_search'
export const SESSION_CREATE_TOOL_NAME = 'session_create'
export const SESSION_DELIVERIES_TOOL_NAME = 'session_deliveries'
export const SESSION_SEND_TOOL_NAME = 'session_send'

export const AGENT_SESSION_DELIVERY_RECOVERABLE_STATUSES = ['accepted', 'delivering'] as const
