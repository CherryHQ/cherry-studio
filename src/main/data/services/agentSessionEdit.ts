import * as z from 'zod'

import type { AgentSessionEditReason } from '@shared/ai/agentSessionEdit'

import { ForkContextDocumentSchema } from './agentSessionForkContext'

export class AgentSessionEditError extends Error {
  constructor(readonly reason: AgentSessionEditReason) {
    super(reason)
    this.name = 'AgentSessionEditError'
  }
}

export const AgentSessionEditOperationSchema = z.object({
  version: z.literal(1),
  operationId: z.string(),
  sessionId: z.string(),
  messageId: z.string(),
  snapshotVersion: z.string(),
  inputHash: z.string(),
  runtime: z.string(),
  nativeSessionId: z.string(),
  resumeToken: z.string().optional(),
  rebuilt: z.boolean(),
  status: z.enum(['preparing', 'prepared', 'committed', 'sending', 'sent', 'failed']),
  userMessageId: z.string().optional(),
  assistantMessageId: z.string().optional(),
  artifactDirectory: z.string(),
  artifactIdentity: z.string().optional(),
  published: z.array(z.object({ source: z.string(), target: z.string(), identity: z.string().optional() })),
  cleanupComplete: z.boolean().optional(),
  executionUncertain: z.boolean().optional(),
  preparedContext: ForkContextDocumentSchema.optional(),
  createdAt: z.number(),
  committedAt: z.number().optional()
})

export type AgentSessionEditOperation = z.infer<typeof AgentSessionEditOperationSchema>
