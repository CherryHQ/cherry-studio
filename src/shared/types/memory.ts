import * as z from 'zod'

export const MemoryScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shared') }),
  z.object({ kind: z.literal('private'), agentId: z.string().min(1) })
])

export type MemoryScope = z.infer<typeof MemoryScopeSchema>
