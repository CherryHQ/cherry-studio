import * as z from 'zod'

export const AgentSessionDeliveryModeSchema = z.enum(['send-now', 'queue', 'auto'])
export type AgentSessionDeliveryMode = z.infer<typeof AgentSessionDeliveryModeSchema>

export const AgentSessionDeliveryStatusSchema = z.enum(['accepted', 'queued', 'delivering', 'consumed', 'failed'])
export type AgentSessionDeliveryStatus = z.infer<typeof AgentSessionDeliveryStatusSchema>

export const AgentSessionDeliveryAddressSchema = z.strictObject({
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  agentName: z.string(),
  sessionName: z.string()
})
export type AgentSessionDeliveryAddress = z.infer<typeof AgentSessionDeliveryAddressSchema>

export const AgentSessionDeliveryErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1)
})
export type AgentSessionDeliveryError = z.infer<typeof AgentSessionDeliveryErrorSchema>

export const AgentSessionDeliverySchema = z.strictObject({
  id: z.string().min(1),
  sender: AgentSessionDeliveryAddressSchema,
  receiver: AgentSessionDeliveryAddressSchema,
  replyTo: AgentSessionDeliveryAddressSchema,
  /** Creation deliveries return the target's terminal output to this address. */
  expectsReply: z.literal(true).optional(),
  mode: AgentSessionDeliveryModeSchema,
  status: AgentSessionDeliveryStatusSchema,
  acceptedAt: z.iso.datetime(),
  scheduledAt: z.iso.datetime().nullable(),
  consumedAt: z.iso.datetime().nullable(),
  failedAt: z.iso.datetime().nullable(),
  error: AgentSessionDeliveryErrorSchema.nullable()
})
export type AgentSessionDelivery = z.infer<typeof AgentSessionDeliverySchema>

export const SESSION_LIST_TOOL_NAME = 'session_list'
export const SESSION_CREATE_TOOL_NAME = 'session_create'
export const SESSION_INBOX_TOOL_NAME = 'session_inbox'
export const SESSION_SEND_TOOL_NAME = 'session_send'

export const AGENT_SESSION_DELIVERY_RECOVERABLE_STATUSES = ['accepted', 'queued', 'delivering'] as const
