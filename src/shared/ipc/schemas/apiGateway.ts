import * as z from 'zod'

import { remoteCapabilitiesSchema } from '@cherrystudio/remote-protocol'
import type { ApiGatewayStatusResult, ApiGatewayStopResult } from '@shared/types/apiGateway'

import { defineRoute } from '../define'

/**
 * Start/stop/restart retain their legacy status results; pairing uses the standard IpcApi error channel.
 * Running state and config remain on their data-layer channels.
 */
const statusResultSchema: z.ZodType<ApiGatewayStatusResult> = z.union([
  z.object({ success: z.literal(true) }),
  z.object({ success: z.literal(false), error: z.string() })
])

const stopResultSchema: z.ZodType<ApiGatewayStopResult> = z.union([
  z.object({ success: z.literal(true), outcome: z.enum(['stopped', 'deferred']) }),
  z.object({ success: z.literal(false), error: z.string() })
])

export const apiGatewayRequestSchemas = {
  'api_gateway.start': defineRoute({ input: z.void(), output: statusResultSchema }),
  'api_gateway.stop': defineRoute({ input: z.void(), output: stopResultSchema }),
  'api_gateway.restart': defineRoute({ input: z.void(), output: statusResultSchema }),
  'api_gateway.lan.set_enabled': defineRoute({ input: z.object({ enabled: z.boolean() }), output: z.void() }),
  'api_gateway.remote.create_invitation': defineRoute({
    input: z.void(),
    output: z.object({
      invitationId: z.string(),
      invitationSecret: z.string(),
      desktopIdentity: z.string(),
      protocolVersions: z.array(z.number()),
      expiresAt: z.string(),
      addresses: z.array(z.string()),
      port: z.number(),
      hostname: z.string()
    })
  }),
  'api_gateway.remote.list_claims': defineRoute({
    input: z.void(),
    output: z.array(
      z.object({
        claimId: z.string(),
        deviceName: z.string(),
        platform: z.string(),
        capabilities: remoteCapabilitiesSchema,
        verificationCode: z.string(),
        expiresAt: z.string()
      })
    )
  }),
  'api_gateway.remote.decide_pairing': defineRoute({
    input: z.object({ claimId: z.string(), capabilities: remoteCapabilitiesSchema.nullable() }),
    output: z.void()
  })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type ApiGatewayEventSchemas = {
  // An agent session could not connect because its model must be bridged through the gateway,
  // which the user keeps disabled. Broadcast; the owning session's UI filters by `sessionId`.
  'api_gateway.required': { sessionId: string }
  'api_gateway.remote.pairing_changed': void
}
