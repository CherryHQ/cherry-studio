import * as z from 'zod'

import { remoteFailureSchema } from '../errors'
import { executionFailureSchema } from '../failure'
import { decimal, digest, opaqueId, timestamp, unicodeText } from '../values'

export const agentAuthorizationSchema = z.looseObject({ domain: z.literal('agent'), grantId: opaqueId })
export const agentCursorSchema = z.strictObject({ sessionId: opaqueId, streamEpoch: opaqueId, seq: decimal })
export const contentRefSchema = z.strictObject({
  contentId: opaqueId,
  revision: decimal,
  byteLength: decimal,
  mediaType: z.string().min(1).max(128),
  sha256: digest
})
export const sessionSchema = z.looseObject({
  sessionId: opaqueId,
  agentId: opaqueId,
  workspaceId: opaqueId,
  workspaceKind: z.enum(['registered', 'system']).optional(),
  title: unicodeText.max(4096),
  updatedAt: timestamp,
  historyRevision: decimal,
  activeExecutionId: opaqueId.optional(),
  idleRevision: decimal.optional()
})
export const executionSchema = z
  .looseObject({
    executionId: opaqueId,
    status: z.enum(['running', 'awaiting-approval', 'finalizing', 'completed', 'cancelled', 'failed', 'interrupted']),
    commandId: opaqueId.optional(),
    messageId: opaqueId.optional(),
    error: remoteFailureSchema.optional(),
    failure: executionFailureSchema.optional(),
    persistenceFailure: executionFailureSchema.optional(),
    history: z.strictObject({ historyRevision: decimal, messageRevision: decimal }).optional(),
    durable: z.boolean()
  })
  .superRefine((value, ctx) => {
    const terminal = ['completed', 'cancelled', 'failed', 'interrupted'].includes(value.status)
    if ((value.status === 'failed') !== Boolean(value.failure))
      ctx.addIssue({ code: 'custom', message: 'Failed executions require a failure; other outcomes cannot carry one' })
    if (
      terminal &&
      (!value.messageId ||
        (value.durable ? !value.history || !!value.persistenceFailure : !value.persistenceFailure || !!value.history))
    )
      ctx.addIssue({ code: 'custom', message: 'Terminal executions require a message and a persistence outcome' })
    if (!terminal && (value.durable || value.history || value.persistenceFailure))
      ctx.addIssue({ code: 'custom', message: 'Running executions cannot claim terminal persistence' })
  })
// Bounded materialized message statistics, not the host's per-request ledger.
const usageCount = z.number().nonnegative()
export const messageUsageSchema = z.looseObject({
  inputTokens: usageCount.optional(),
  outputTokens: usageCount.optional(),
  totalTokens: usageCount.optional(),
  noCacheTokens: usageCount.optional(),
  cacheReadTokens: usageCount.optional(),
  cacheWriteTokens: usageCount.optional(),
  reasoningTokens: usageCount.optional(),
  durationMs: usageCount.optional(),
  toolDurationMs: usageCount.optional(),
  approvalDurationMs: usageCount.optional(),
  requestCount: z.number().int().nonnegative().optional(),
  hasUnpricedRecords: z.boolean().optional(),
  costs: z
    .array(
      z.looseObject({
        currency: z.string().regex(/^[A-Z]{3}$/),
        amount: usageCount,
        providerReportedRequestCount: z.number().int().nonnegative(),
        computedRequestCount: z.number().int().nonnegative()
      })
    )
    .max(32)
    .optional()
})
export type AgentMessageUsage = z.infer<typeof messageUsageSchema>

/** Public model identity; no provider configuration or credentials. */
export const modelSummarySchema = z.looseObject({
  modelId: unicodeText.min(1).max(2048),
  providerId: opaqueId,
  name: unicodeText.min(1).max(2048)
})

export const messageSchema = z
  .looseObject({
    messageId: opaqueId,
    revision: decimal,
    role: z.enum(['user', 'assistant', 'system']),
    partIds: z.array(opaqueId).max(4096),
    status: z.enum(['pending', 'success', 'error', 'paused']),
    usage: messageUsageSchema.optional(),
    model: modelSummarySchema.optional(),
    failure: executionFailureSchema.optional()
  })
  .superRefine((value, ctx) => {
    if ((value.status === 'error') !== Boolean(value.failure))
      ctx.addIssue({ code: 'custom', message: 'Error messages require a failure; other outcomes cannot carry one' })
  })
const partBase = {
  partId: opaqueId,
  revision: decimal,
  executionId: opaqueId.optional(),
  toolCallId: opaqueId.optional()
}
const content = z.union([z.strictObject({ text: unicodeText.max(65_536) }), z.strictObject({ ref: contentRefSchema })])
export const partSchema = z.discriminatedUnion('kind', [
  z.looseObject({ ...partBase, kind: z.literal('text'), content, state: z.enum(['streaming', 'completed']) }),
  z.looseObject({ ...partBase, kind: z.literal('reasoning'), content, state: z.enum(['streaming', 'completed']) }),
  z.looseObject({
    ...partBase,
    kind: z.literal('tool-input'),
    toolName: opaqueId,
    content,
    state: z.enum(['streaming', 'completed'])
  }),
  z.looseObject({
    ...partBase,
    kind: z.literal('tool-output'),
    toolName: opaqueId,
    content,
    state: z.enum(['completed', 'failed'])
  }),
  z.looseObject({ ...partBase, kind: z.literal('file'), name: unicodeText.max(1024), ref: contentRefSchema }),
  z.looseObject({ ...partBase, kind: z.literal('data'), name: opaqueId, content })
])
export const workspaceSelectionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('registered'), id: opaqueId }),
  z.strictObject({ kind: z.literal('system') })
])
export const questionInputSchema = z
  .looseObject({
    questions: z
      .array(
        z.looseObject({
          question: unicodeText.min(1).max(4096),
          header: unicodeText.max(256).optional(),
          options: z
            .array(
              z.looseObject({ label: unicodeText.min(1).max(4096), description: unicodeText.max(4096).optional() })
            )
            .max(16),
          multiSelect: z.boolean().optional()
        })
      )
      .min(1)
      .max(4)
  })
  .refine(
    ({ questions }) => new Set(questions.map((q) => q.question)).size === questions.length,
    'Question keys must be unique'
  )
export const interactionResponseSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('approve') }),
  z.strictObject({ kind: z.literal('deny'), reason: unicodeText.min(1).max(4096).optional() }),
  z.strictObject({
    kind: z.literal('answer'),
    answers: z
      .record(unicodeText.min(1).max(4096), unicodeText.min(1).max(8192))
      .refine((answers) => Object.keys(answers).length > 0 && Object.keys(answers).length <= 4)
  })
])
export type AgentWorkspaceSelection = z.infer<typeof workspaceSelectionSchema>
export type AgentInteractionResponse = z.infer<typeof interactionResponseSchema>

export const interactionSummarySchema = z.looseObject({
  interactionId: opaqueId,
  revision: decimal,
  executionId: opaqueId,
  toolCallId: opaqueId,
  status: z.enum(['pending', 'approved', 'denied', 'expired']),
  summary: unicodeText.max(2048),
  kind: z.enum(['decision', 'question']).optional(),
  inputDigest: digest,
  expiresAt: timestamp.optional()
})
export const interactionSchema = interactionSummarySchema.extend({ input: content })
export const commandReceiptSchema = z.looseObject({
  commandId: opaqueId,
  method: opaqueId,
  status: z.enum(['accepted', 'applied', 'rejected', 'interrupted']),
  admittedAt: timestamp,
  sessionId: opaqueId.optional(),
  executionId: opaqueId.optional(),
  result: z.json().optional(),
  error: remoteFailureSchema.optional()
})
export type AgentAuthorization = z.infer<typeof agentAuthorizationSchema>
export type AgentCursor = z.infer<typeof agentCursorSchema>
export type AgentSession = z.infer<typeof sessionSchema>
export type AgentMessage = z.infer<typeof messageSchema>
export type AgentPart = z.infer<typeof partSchema>
export type AgentExecution = z.infer<typeof executionSchema>
export type AgentInteraction = z.infer<typeof interactionSchema>
export type ContentRef = z.infer<typeof contentRefSchema>
export type CommandReceipt = z.infer<typeof commandReceiptSchema>
