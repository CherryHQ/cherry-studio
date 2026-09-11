import * as z from 'zod'

export const AgentSessionForkUnavailableReasonSchema = z.enum([
  'legacy_history',
  'not_turn_boundary',
  'checkpoint_failed',
  'history_missing',
  'history_corrupt',
  'unsupported_checkpoint',
  'history_changed'
])

export type AgentSessionForkUnavailableReason = z.infer<typeof AgentSessionForkUnavailableReasonSchema>

export function canRebuildAgentSessionFork(reason: string): boolean {
  return AgentSessionForkUnavailableReasonSchema.safeParse(reason).success && reason !== 'not_turn_boundary'
}

export const AgentSessionForkFailureReasonSchema = z.enum([
  ...AgentSessionForkUnavailableReasonSchema.options,
  'workspace_changed',
  'workspace_unsupported_file',
  'operation_failed'
])
export type AgentSessionForkFailureReason = z.infer<typeof AgentSessionForkFailureReasonSchema>

export const AgentSessionForkAvailabilitySchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('available') }),
  z.strictObject({ status: z.literal('unavailable'), reason: AgentSessionForkUnavailableReasonSchema })
])

export type AgentSessionForkAvailability = z.infer<typeof AgentSessionForkAvailabilitySchema>

/** Project only availability; native checkpoint identifiers must never leave Main. */
export function getAgentSessionForkAvailability(value: unknown): AgentSessionForkAvailability {
  if (value == null) return { status: 'unavailable', reason: 'legacy_history' }
  if (typeof value !== 'object' || !('version' in value) || value.version !== 1) {
    return { status: 'unavailable', reason: 'unsupported_checkpoint' }
  }
  if ('status' in value && value.status === 'available') return { status: 'available' }
  const reason = AgentSessionForkUnavailableReasonSchema.safeParse('reason' in value ? value.reason : undefined)
  return { status: 'unavailable', reason: reason.success ? reason.data : 'unsupported_checkpoint' }
}
