import * as z from 'zod'

import { defineRoute } from '../define'

const httpUrl = z
  .url({ protocol: /^https?$/ })
  .max(2048)
  .refine((value) => {
    const url = URL.parse(value)
    return url !== null && !url.username && !url.password && !url.hash
  })
const originUrl = httpUrl.refine((value) => {
  const url = URL.parse(value)
  return url !== null && url.pathname === '/' && !url.search
})

export const sandboxRequestSchemas = {
  'sandbox.probe': defineRoute({
    input: z.void(),
    output: z.object({ status: z.enum(['ready', 'unavailable', 'setup-required']), report: z.string() })
  }),
  'sandbox.run': defineRoute({
    input: z.object({ code: z.string().min(1).max(32768), timeoutMs: z.number().int().min(100).max(30000) }).strict(),
    output: z.object({ stdout: z.string(), stderr: z.string(), report: z.string() })
  }),
  'sandbox.diagnose': defineRoute({
    input: z.object({ group: z.enum(['files', 'rpc', 'instances', 'network']) }).strict(),
    output: z.object({
      results: z.array(
        z.object({
          id: z.string(),
          status: z.enum(['passed', 'failed', 'unsupported', 'cancelled', 'inconclusive']),
          expected: z.string(),
          actual: z.string()
        })
      ),
      report: z.string()
    })
  }),
  'sandbox.request': defineRoute({
    input: z.discriminatedUnion('kind', [
      z
        .object({ kind: z.literal('rpc'), value: z.number().min(-1000000).max(1000000), allowCallback: z.boolean() })
        .strict(),
      z.object({ kind: z.literal('network'), url: httpUrl, allowedOrigins: z.array(originUrl).max(64) }).strict()
    ]),
    output: z.object({
      trace: z.array(
        z.object({
          step: z.enum(['policy', 'request', 'callback', 'callback-result', 'response', 'error', 'cleanup']),
          elapsedMs: z.number(),
          detail: z.string()
        })
      ),
      report: z.string()
    })
  }),
  'sandbox.stop': defineRoute({ input: z.void(), output: z.void() })
}
