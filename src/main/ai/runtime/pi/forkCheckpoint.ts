import * as z from 'zod'

import { AgentSessionForkError } from '../fork'

export const PiForkCheckpointSchema = z.strictObject({
  runtime: z.literal('pi'),
  runtimeSessionId: z.string().min(1),
  leafId: z.string().min(1)
})

export type PiForkCheckpoint = z.infer<typeof PiForkCheckpointSchema>

export const parsePiForkCheckpoint = PiForkCheckpointSchema.catch(() => {
  throw new AgentSessionForkError('unsupported_checkpoint')
}).parse
