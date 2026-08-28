import type { SerializedError } from '@renderer/types/error'
import type { DiagnosisContext } from '@renderer/utils/errorDiagnosis'
import { normalizeDiagnosticDescription } from '@shared/utils/diagnostics'

export const DIAGNOSTIC_REPORT_PREFILL_MAX_BYTES = 2_048

export interface DiagnosticReportConfig {
  location: string
}

export interface DiagnosticReportDescriptionLabels {
  errorMessage: string
  errorName: string
  location: string
  model: string
  provider: string
  statusCode: string
}

interface BuildDiagnosticReportDescriptionInput extends DiagnosticReportConfig {
  diagnosisContext?: DiagnosisContext
  error?: SerializedError
  labels: DiagnosticReportDescriptionLabels
}

function nonEmptyText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function appendLine(lines: string[], label: string, value: unknown) {
  const text = typeof value === 'number' ? String(value) : nonEmptyText(value)
  if (text) lines.push(`${label}: ${text}`)
}

function truncateUtf8(value: string): string {
  const encoder = new TextEncoder()
  let byteLength = 0
  let result = ''

  for (const character of normalizeDiagnosticDescription(value)) {
    const characterBytes = encoder.encode(character).byteLength
    if (byteLength + characterBytes > DIAGNOSTIC_REPORT_PREFILL_MAX_BYTES) break
    result += character
    byteLength += characterBytes
  }

  return result.endsWith('\r') ? result.slice(0, -1) : result
}

export function buildDiagnosticReportDescription({
  diagnosisContext,
  error,
  labels,
  location
}: BuildDiagnosticReportDescriptionInput): string {
  const lines: string[] = []
  const errorRecord = error as Record<string, unknown> | undefined

  appendLine(lines, labels.location, location)
  appendLine(lines, labels.provider, diagnosisContext?.providerName)
  appendLine(lines, labels.model, diagnosisContext?.modelId)
  appendLine(lines, labels.errorName, error?.name)
  appendLine(lines, labels.statusCode, errorRecord?.status ?? errorRecord?.statusCode)
  appendLine(lines, labels.errorMessage, error?.message)

  return truncateUtf8(lines.join('\n'))
}
