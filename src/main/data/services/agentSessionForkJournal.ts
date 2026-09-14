import * as z from 'zod'

export const FORK_JOURNAL_PREFIX = 'agent-session-fork:'

/** Main-owned recovery data. Version 1 records carry no authority to remove an adopted workspace. */
export const AgentSessionForkJournalSchema = z.strictObject({
  version: z.union([z.literal(1), z.literal(2)]),
  operationId: z.uuid(),
  sourceSessionId: z.uuid(),
  messageId: z.uuid(),
  targetSessionId: z.uuid(),
  createdAt: z.number().int(),
  artifactDirectory: z.string(),
  artifactIdentity: z.string().optional(),
  workspace: z.string().optional(),
  workspaceIdentity: z.string().optional(),
  published: z.array(z.strictObject({ source: z.string(), target: z.string(), identity: z.string().optional() })),
  committed: z.boolean(),
  cleanupState: z.literal('active').optional(),
  workspaceDisposition: z.literal('retained').optional(),
  cleanupComplete: z.boolean().optional()
})

export type AgentSessionForkJournal = z.infer<typeof AgentSessionForkJournalSchema>
