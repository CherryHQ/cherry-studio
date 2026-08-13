import type { ApiGatewayStatusResult } from '@shared/types/apiGateway'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * API Gateway IPC schemas — start/stop/restart the local API gateway. Each returns an
 * ApiGatewayStatusResult: the handler turns the service method's throw into
 * `{ success: false, error }`. By design there are no status/config pull routes —
 * running state is read via useSharedCache and config via the DataApi preference layer.
 */
const statusResultSchema: z.ZodType<ApiGatewayStatusResult> = z.union([
  z.object({ success: z.literal(true) }),
  z.object({ success: z.literal(false), error: z.string() })
])

export const apiGatewayRequestSchemas = {
  'api_gateway.start': defineRoute({ input: z.void(), output: statusResultSchema }),
  'api_gateway.stop': defineRoute({ input: z.void(), output: statusResultSchema }),
  'api_gateway.restart': defineRoute({ input: z.void(), output: statusResultSchema })
}

// ── Event: main→renderer pushes (pure types, never parsed) ──
export type ApiGatewayEventSchemas = {
  // An agent session could not connect because its model must be bridged through the gateway,
  // which the user keeps disabled. Broadcast; the owning session's UI filters by `sessionId`.
  'api_gateway.required': { sessionId: string }
}
