import {
  DIAGNOSTIC_AI_ID_MAX,
  DIAGNOSTIC_AI_TEXT_MAX,
  type DiagnosticAiDiagnosis,
  diagnosticAiDiagnosisSchema
} from '../types/diagnosticAi'
import { redactSecretText, redactSecretTokens } from './redaction'

function boundedIdentifier(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > DIAGNOSTIC_AI_ID_MAX) return undefined
  return trimmed
}

/** Allowlisted, redacted copy. Keeps an existing truncation mark and adds one when this copy is clipped. */
export function projectDiagnosticAiDiagnosis(diagnosis: DiagnosticAiDiagnosis): DiagnosticAiDiagnosis | undefined {
  const redacted = redactSecretTokens(redactSecretText(diagnosis.text)).trim()
  if (redacted.length === 0) return undefined
  const clipped = redacted.length > DIAGNOSTIC_AI_TEXT_MAX
  const text = clipped ? redacted.slice(0, DIAGNOSTIC_AI_TEXT_MAX) : redacted
  const truncated = clipped || diagnosis.truncated === true
  const scope = boundedIdentifier(diagnosis.scope)
  const runId = boundedIdentifier(diagnosis.runId)
  const reportRunId = boundedIdentifier(diagnosis.reportRunId)
  const modelId = boundedIdentifier(diagnosis.modelId)
  const startedAt = boundedIdentifier(diagnosis.startedAt)
  const errorId = boundedIdentifier(diagnosis.errorId)
  const topicId = boundedIdentifier(diagnosis.topicId)
  const messageId = boundedIdentifier(diagnosis.messageId)

  return Object.freeze({
    source: diagnosis.source,
    status: diagnosis.status,
    text,
    ...(truncated ? { truncated: true as const } : {}),
    ...(scope ? { scope } : {}),
    ...(runId ? { runId } : {}),
    ...(reportRunId ? { reportRunId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(errorId ? { errorId } : {}),
    ...(topicId ? { topicId } : {}),
    ...(messageId ? { messageId } : {})
  })
}

function suppliedErrorContextId(errorContext: unknown): string | undefined {
  if (typeof errorContext !== 'object' || errorContext === null || !('id' in errorContext)) return undefined
  const id = errorContext.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/**
 * Parsed diagnosis for a bundle entry.
 * A fault id on the error context requires the same id; a diagnosis with no id is not attached to that fault.
 */
export function selectDiagnosticAiAttachment(
  diagnosis: unknown,
  errorContext?: unknown
): DiagnosticAiDiagnosis | undefined {
  const parsed = diagnosticAiDiagnosisSchema.safeParse(diagnosis)
  if (!parsed.success) return undefined
  const contextId = suppliedErrorContextId(errorContext)
  if (contextId !== undefined && parsed.data.errorId !== contextId) return undefined
  return projectDiagnosticAiDiagnosis(parsed.data)
}
