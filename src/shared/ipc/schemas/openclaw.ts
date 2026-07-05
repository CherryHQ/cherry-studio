import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * OpenClaw gateway runtime schemas.
 * Install/update via CodeCliService → BinaryManager.
 */
const gatewayStatusResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional()
})

// ── Request schemas ──
export const openclawRequestSchemas = {
  'openclaw.start_gateway': defineRoute({
    input: z.number().optional(),
    output: gatewayStatusResultSchema
  }),
  'openclaw.stop_gateway': defineRoute({
    input: z.void(),
    output: gatewayStatusResultSchema
  }),
  'openclaw.get_status': defineRoute({
    input: z.void(),
    output: z.object({ status: z.enum(['stopped', 'starting', 'running', 'error']), port: z.number() })
  }),
  'openclaw.get_dashboard_url': defineRoute({
    input: z.void(),
    output: z.string()
  }),
  'openclaw.sync_config': defineRoute({
    input: z.string(),
    output: gatewayStatusResultSchema
  })
}
