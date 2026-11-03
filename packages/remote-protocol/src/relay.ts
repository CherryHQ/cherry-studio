import * as z from 'zod'

export const relayOriginSchema = z
  .string()
  .max(2048)
  .transform((value, ctx) => {
    try {
      if (!/^https:\/\/[^/?#\s\\]+\/?$/.test(value)) throw new Error('Expected HTTPS origin')
      const url = new URL(value)
      if (url.username || url.password || url.pathname !== '/') throw new Error('Expected origin')
      return url.origin
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Expected a Relay HTTPS origin without credentials, path or query' })
      return z.NEVER
    }
  })

export const relayEndpointSchema = z.strictObject({
  origin: relayOriginSchema,
  targetId: z.string().regex(/^[a-f0-9]{64}$/)
})

export type RelayEndpoint = z.infer<typeof relayEndpointSchema>
