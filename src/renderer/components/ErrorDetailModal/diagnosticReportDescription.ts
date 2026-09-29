import type { SerializedError } from '@renderer/types/error'
import type { DiagnosisContext } from '@renderer/utils/errorDiagnosis'
import { normalizeDiagnosticDescription } from '@shared/utils/diagnostics'

export const DIAGNOSTIC_REPORT_PREFILL_MAX_BYTES = 2_048

export interface DiagnosticReportConfig {
  location: string
}

const AGENT_LOCATION_LABELS = new Set(['agent', 'Agent 对话', 'Agent 對話'])

export function resolveDiagnosticReportLocation(
  t: (key: string, options?: { defaultValue?: string }) => string,
  location: string,
  language?: string
): string {
  if (AGENT_LOCATION_LABELS.has(location.trim())) {
    return t('error.diagnostic_report.locations.work', {
      defaultValue: language?.toLowerCase().startsWith('zh') ? '工作对话' : 'Work conversation'
    })
  }
  if (location.trim() === 'home') return t('error.diagnostic_report.locations.home')
  return location
}

export interface DiagnosticReportDescriptionLabels {
  errorMessage: string
  location: string
  model: string
}

interface BuildDiagnosticReportDescriptionInput extends DiagnosticReportConfig {
  diagnosisContext?: DiagnosisContext
  error?: SerializedError
  localizedErrorMessage?: string
  labels: DiagnosticReportDescriptionLabels
}

interface DiagnosticReportFieldsInput {
  diagnosisContext?: DiagnosisContext
  error?: SerializedError
  localizedErrorMessage?: string
  location?: string
}

type DiagnosticReportField = {
  id: keyof DiagnosticReportDescriptionLabels
  value: string | number
}

function nonEmptyText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function diagnosticReportField(id: DiagnosticReportField['id'], value: unknown): DiagnosticReportField | undefined {
  if (typeof value === 'number') return { id, value }
  const text = nonEmptyText(value)
  return text ? { id, value: text } : undefined
}

function combineErrorParts(localized: unknown, name: unknown, message: unknown): string | undefined {
  const errorName = nonEmptyText(name)
  const errorMessage = nonEmptyText(message)
  const raw = errorName && errorMessage ? `${errorName}: ${errorMessage}` : (errorName ?? errorMessage)
  const localizedMessage = nonEmptyText(localized)
  if (localizedMessage && errorMessage && localizedMessage !== errorMessage) {
    return `${localizedMessage} (${errorMessage})`
  }
  return localizedMessage ?? raw
}

function combineModelParts(provider: unknown, model: unknown): string | undefined {
  const providerName = nonEmptyText(provider)
  const modelId = nonEmptyText(model)
  if (providerName && modelId) return `${providerName}:${modelId}`
  return providerName ?? modelId
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

export function diagnosticReportFields({
  diagnosisContext,
  error,
  location,
  localizedErrorMessage
}: DiagnosticReportFieldsInput): DiagnosticReportField[] {
  return [
    diagnosticReportField('location', location),
    diagnosticReportField('model', combineModelParts(diagnosisContext?.providerId, diagnosisContext?.modelId)),
    diagnosticReportField('errorMessage', combineErrorParts(localizedErrorMessage, error?.name, error?.message))
  ].filter((field): field is DiagnosticReportField => field !== undefined)
}

export function buildDiagnosticReportDescription({
  diagnosisContext,
  error,
  labels,
  location,
  localizedErrorMessage
}: BuildDiagnosticReportDescriptionInput): string {
  const lines = diagnosticReportFields({ diagnosisContext, error, location, localizedErrorMessage }).map(
    ({ id, value }) => `${labels[id]}: ${value}`
  )

  return truncateUtf8(lines.join('\n'))
}
