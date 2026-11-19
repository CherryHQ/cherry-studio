import * as z from 'zod'

export const agentImportSnapshotSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().default(0),
  agentId: z.string(),
  status: z.enum(['ready', 'running', 'completed', 'cancelled', 'failed', 'interrupted']),
  conversations: z.number().int(),
  messages: z.number().int(),
  imported: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  remaining: z.number().int(),
  missingFiles: z.array(z.string()),
  sessionIds: z.array(z.string()),
  error: z.string().optional()
})
export type AgentImportSnapshot = z.infer<typeof agentImportSnapshotSchema>
