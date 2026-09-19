import * as z from 'zod'

import { AgentSessionForkError } from '../fork'

export const ClaudeForkCheckpointSchema = z.strictObject({
  runtime: z.literal('claude-code'),
  runtimeSessionId: z.string().min(1),
  messageUuid: z.uuid(),
  configDir: z.string().min(1)
})

export type ClaudeForkCheckpoint = z.infer<typeof ClaudeForkCheckpointSchema>

export function parseClaudeForkCheckpoint(value: unknown): ClaudeForkCheckpoint {
  const parsed = ClaudeForkCheckpointSchema.safeParse(value)
  if (!parsed.success) throw new AgentSessionForkError('unsupported_checkpoint')
  return parsed.data
}

export const ClaudeForkResultSchema = z.strictObject({
  resumeToken: z.string().min(1),
  checkpoints: z.array(ClaudeForkCheckpointSchema),
  publish: z.array(z.strictObject({ source: z.string().min(1), target: z.string().min(1) }))
})
