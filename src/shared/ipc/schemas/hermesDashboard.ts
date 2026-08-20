import * as z from 'zod'

import { defineRoute } from '../define'
import { operationResultSchema } from './common'

const hermesDashboardStatusSchema = z.enum(['stopped', 'starting', 'running', 'error'])

export const hermesDashboardRequestSchemas = {
  'hermes_dashboard.start': defineRoute({
    input: z.void(),
    output: z.discriminatedUnion('success', [
      z.object({ success: z.literal(true), url: z.string().url() }),
      z.object({ success: z.literal(false), message: z.string() })
    ])
  }),
  'hermes_dashboard.stop': defineRoute({
    input: z.void(),
    output: operationResultSchema
  }),
  'hermes_dashboard.get_status': defineRoute({
    input: z.void(),
    output: z.object({ status: hermesDashboardStatusSchema, url: z.string().url().optional() })
  })
}
