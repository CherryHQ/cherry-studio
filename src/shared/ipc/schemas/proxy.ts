import * as z from 'zod'

import { defineRoute } from '../define'

const proxyConnectionTestResultSchema = z.object({
  target: z.string(),
  route: z.enum(['proxy', 'bypassed', 'direct']),
  success: z.boolean(),
  error: z
    .enum(['invalid_config', 'authentication_required', 'timeout', 'unreachable', 'http_error', 'connection_failed'])
    .optional()
})

export const proxyRequestSchemas = {
  'proxy.test_connection': defineRoute({
    input: z.object({
      mode: z.enum(['system', 'custom', 'none']),
      url: z.string(),
      bypassRules: z.string()
    }),
    output: proxyConnectionTestResultSchema
  })
}
