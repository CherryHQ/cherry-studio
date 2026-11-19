import * as z from 'zod'

/** IPC and the archive share this text budget. Longer input is clipped and marked `truncated`. */
export const DIAGNOSTIC_AI_TEXT_MAX = 64_000
export const DIAGNOSTIC_AI_ID_MAX = 200

const diagnosticAiIdentifierSchema = z.string().min(1).max(DIAGNOSTIC_AI_ID_MAX)

/**
 * One AI diagnosis submitted with a diagnostic bundle.
 * Absent metadata stays absent: callers must not invent model or run identity.
 * `truncated` is set when a longer reply was capped before it crossed IPC.
 */
export const diagnosticAiDiagnosisSchema = z
  .object({
    source: z.enum(['doctor-agent', 'error-summary']),
    text: z.string().min(1).max(DIAGNOSTIC_AI_TEXT_MAX),
    status: z.enum(['completed', 'failed', 'canceled']),
    truncated: z.literal(true).optional(),
    scope: diagnosticAiIdentifierSchema.optional(),
    runId: diagnosticAiIdentifierSchema.optional(),
    reportRunId: diagnosticAiIdentifierSchema.optional(),
    modelId: diagnosticAiIdentifierSchema.optional(),
    startedAt: diagnosticAiIdentifierSchema.optional(),
    errorId: diagnosticAiIdentifierSchema.optional(),
    topicId: diagnosticAiIdentifierSchema.optional(),
    messageId: diagnosticAiIdentifierSchema.optional()
  })
  .strict()

export type DiagnosticAiDiagnosis = z.infer<typeof diagnosticAiDiagnosisSchema>
