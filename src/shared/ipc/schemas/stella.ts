import * as z from 'zod'

import { defineRoute } from '../define'

const endpointSchema = z.string().trim().min(1).max(2_048)
const patSchema = z.string().min(1).max(16_384)

export const stellaRequestSchemas = {
  'stella.configure_connection': defineRoute({
    input: z.strictObject({ endpoint: endpointSchema, pat: patSchema }),
    output: z.strictObject({ endpoint: z.string(), configured: z.literal(true) })
  }),
  'stella.list_agents': defineRoute({
    input: z.void(),
    output: z.array(
      z.strictObject({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        avatar: z.string().optional()
      })
    )
  })
}
