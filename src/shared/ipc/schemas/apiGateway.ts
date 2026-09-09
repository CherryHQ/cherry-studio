import type {
  ApiGatewayPairingOfferResult,
  ApiGatewayStatusResult,
  ApiGatewayStopResult
} from '@shared/types/apiGateway'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * API Gateway IPC schemas — start/stop/restart the local API gateway. Stop additionally reports
 * whether shutdown completed or is deferred by a lease. Handlers turn service throws into
 * `{ success: false, error }`; running state and config remain on their data-layer channels.
 */
const statusResultSchema: z.ZodType<ApiGatewayStatusResult> = z.union([
  z.object({ success: z.literal(true) }),
  z.object({ success: z.literal(false), error: z.string() })
])

const stopResultSchema: z.ZodType<ApiGatewayStopResult> = z.union([
  z.object({ success: z.literal(true), outcome: z.enum(['stopped', 'deferred']) }),
  z.object({ success: z.literal(false), error: z.string() })
])

const pairingOfferResultSchema: z.ZodType<ApiGatewayPairingOfferResult> = z.union([
  z.object({
    success: z.literal(true),
    hostname: z.string(),
    port: z.number(),
    addresses: z.array(z.string()).min(1),
    code: z.string(),
    expiresAt: z.number()
  }),
  z.object({ success: z.literal(false), error: z.string() })
])

export const apiGatewayRequestSchemas = {
  'api_gateway.start': defineRoute({ input: z.void(), output: statusResultSchema }),
  'api_gateway.stop': defineRoute({ input: z.void(), output: stopResultSchema }),
  'api_gateway.restart': defineRoute({ input: z.void(), output: statusResultSchema }),
  'api_gateway.create_pairing_offer': defineRoute({ input: z.void(), output: pairingOfferResultSchema })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type ApiGatewayEventSchemas = {
  // An agent session could not connect because its model must be bridged through the gateway,
  // which the user keeps disabled. Broadcast; the owning session's UI filters by `sessionId`.
  'api_gateway.required': { sessionId: string }
  'api_gateway.pairing_completed': { deviceId: string }
}
