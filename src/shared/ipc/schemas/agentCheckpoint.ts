import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * O1 — pre-turn workspace snapshot + one-click undo for autonomous agent turns.
 * A checkpoint is taken automatically right before every turn (see
 * `CheckpointService`); these routes only query/consume it.
 */
export const agentCheckpointRequestSchemas = {
  'agent_checkpoint.get': defineRoute({
    input: z.strictObject({ sessionId: z.string().min(1) }),
    output: z.strictObject({
      available: z.boolean(),
      createdAt: z.number().optional()
    })
  }),
  'agent_checkpoint.restore': defineRoute({
    input: z.strictObject({ sessionId: z.string().min(1) }),
    output: z.strictObject({ restored: z.boolean() })
  })
}

/** Fired whenever a session's checkpoint becomes available or is consumed/superseded. */
export type AgentCheckpointEventSchemas = {
  'agent_checkpoint.updated': { sessionId: string; available: boolean }
}
