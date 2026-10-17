import * as z from 'zod'

import { defineRoute } from '../define'

export const sandboxRequestSchemas = {
  'sandbox.probe': defineRoute({
    input: z.void(),
    output: z.object({ status: z.enum(['ready', 'unavailable', 'setup-required']), report: z.string() })
  }),
  'sandbox.run': defineRoute({
    input: z.object({ code: z.string().min(1).max(32768), timeoutMs: z.number().int().min(100).max(30000) }).strict(),
    output: z.object({ stdout: z.string(), stderr: z.string(), report: z.string() })
  }),
  'sandbox.stop': defineRoute({ input: z.void(), output: z.void() })
}
