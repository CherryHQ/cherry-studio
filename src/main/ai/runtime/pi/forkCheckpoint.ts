import * as z from 'zod'

import { AgentSessionForkError } from '../fork'

export const PiForkCheckpointSchema = z.strictObject({
  runtime: z.literal('pi'),
  runtimeSessionId: z.string().min(1),
  leafId: z.string().min(1)
})

export type PiForkCheckpoint = z.infer<typeof PiForkCheckpointSchema>

export function parsePiForkCheckpoint(value: unknown): PiForkCheckpoint {
  const parsed = PiForkCheckpointSchema.safeParse(value)
  if (!parsed.success) throw new AgentSessionForkError('unsupported_checkpoint')
  return parsed.data
}
