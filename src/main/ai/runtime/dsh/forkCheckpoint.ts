import * as z from 'zod'

import { AgentSessionForkError } from '../fork'

export const DshForkCheckpointSchema = z.strictObject({
  runtime: z.literal('dsh'),
  runtimeSessionId: z.string().min(1),
  boundary: z.number().int().nonnegative()
})

export type DshForkCheckpoint = z.infer<typeof DshForkCheckpointSchema>

export function parseDshForkCheckpoint(value: unknown): DshForkCheckpoint {
  const parsed = DshForkCheckpointSchema.safeParse(value)
  if (!parsed.success) throw new AgentSessionForkError('unsupported_checkpoint')
  return parsed.data
}
