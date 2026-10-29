import * as z from 'zod'

// Routing is persisted here; each runtime owns its opaque native checkpoint fields.
const RuntimeForkCheckpointSchema = z.looseObject({ runtime: z.string().min(1) })

export const RuntimeForkAnchorSchema = z.strictObject({
  checkpoint: RuntimeForkCheckpointSchema,
  excludedMessageIds: z.array(z.string()).optional()
})

export type RuntimeForkCheckpoint = z.infer<typeof RuntimeForkCheckpointSchema>
export type RuntimeForkAnchor = z.infer<typeof RuntimeForkAnchorSchema>
