import * as z from 'zod'

/**
 * Why a runtime opened a turn on its own, with no host-admitted user message. Closed set — each
 * member has a runtime that produces it today (`goal-round`: dsh's goal-round-driver;
 * `background-work`: Claude Code waking the main agent).
 */
export const AutonomousTurnOriginSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('goal-round'), round: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('background-work') })
])
export type AutonomousTurnOrigin = z.infer<typeof AutonomousTurnOriginSchema>

/** Live, per-message explanation for a runtime-started assistant turn. Shared cache, like the
 *  api-retry status: it rides the session and is gone after a restart — not conversation content. */
export const AGENT_SESSION_TURN_ORIGIN_CACHE_KEY = (sessionId: string, messageId: string) =>
  `agent.session.turn_origin.${sessionId}.${messageId}` as const
