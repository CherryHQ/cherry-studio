import type { TFunction } from 'i18next'

import { formatFileSize } from './file'

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
    size: formatFileSize(source!.estimatedBytes)
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
    size: formatFileSize(source!.estimatedBytes)
  })
}
