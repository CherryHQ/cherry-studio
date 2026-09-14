import type { TFunction } from 'i18next'

interface DiagnosticFileSourceSummary {
  readonly available: boolean
  readonly estimatedBytes: number
  readonly fileCount: number
}

interface DiagnosticChatSourceSummary {
  readonly available: boolean
  readonly estimatedBytes: number
  readonly messageCount: number
}

export function formatDiagnosticBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unitIndex
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function describeUnavailableSource(
  t: TFunction,
  source: { readonly available: boolean } | undefined,
  isInspectionPending: boolean
): string | null {
  if (isInspectionPending) return t('settings.about.diagnostics.sources.inspecting')
  if (!source?.available) return t('settings.about.diagnostics.sources.unavailable')
  return null
}

export function describeDiagnosticFileSource(
  t: TFunction,
  source: DiagnosticFileSourceSummary | undefined,
  isInspectionPending: boolean
): string {
  const unavailableDescription = describeUnavailableSource(t, source, isInspectionPending)
  if (unavailableDescription) return unavailableDescription
  return t('settings.about.diagnostics.sources.summary', {
    count: source!.fileCount,
    size: formatDiagnosticBytes(source!.estimatedBytes)
  })
}

export function describeDiagnosticChatSource(
  t: TFunction,
  source: DiagnosticChatSourceSummary | undefined,
  isInspectionPending: boolean
): string {
  const unavailableDescription = describeUnavailableSource(t, source, isInspectionPending)
  if (unavailableDescription) return unavailableDescription
  return t('settings.about.diagnostics.sources.message_summary', {
    count: source!.messageCount,
    size: formatDiagnosticBytes(source!.estimatedBytes)
  })
}
