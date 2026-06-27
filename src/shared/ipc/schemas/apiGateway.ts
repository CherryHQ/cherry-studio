import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * API Gateway IPC schemas — imperative start/stop/restart calls that delegate to
 * ApiGatewayService. No events: running state and config reach the renderer via
 * shared cache and DataApi preferences respectively.
 */

const apiGatewayStatusResultSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true) }),
  z.object({ success: z.literal(false), error: z.string() })
])

// ── Request: renderer→main calls (zod values, always parsed) ──
export const apiGatewayRequestSchemas = {
  'api_gateway.start': defineRoute({ input: z.void(), output: apiGatewayStatusResultSchema }),
  'api_gateway.stop': defineRoute({ input: z.void(), output: apiGatewayStatusResultSchema }),
  'api_gateway.restart': defineRoute({ input: z.void(), output: apiGatewayStatusResultSchema })
}
