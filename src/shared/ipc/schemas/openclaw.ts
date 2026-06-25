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

const healthInfoSchema = z.object({
  status: z.enum(['healthy', 'unhealthy']),
  gatewayPort: z.number()
})

const channelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  status: z.enum(['connected', 'disconnected', 'error'])
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
  'openclaw.check_health': defineRoute({
    input: z.void(),
    output: healthInfoSchema
  }),
  'openclaw.get_dashboard_url': defineRoute({
    input: z.void(),
    output: z.string()
  }),
  'openclaw.get_channels': defineRoute({
    input: z.void(),
    output: z.array(channelInfoSchema)
  }),
  'openclaw.check_update': defineRoute({
    input: z.void(),
    output: z.object({
      hasUpdate: z.boolean(),
      currentVersion: z.string().nullable(),
      latestVersion: z.string().nullable(),
      message: z.string().optional()
    })
  }),
  'openclaw.perform_update': defineRoute({
    input: z.void(),
    output: gatewayStatusResultSchema
  })
}
