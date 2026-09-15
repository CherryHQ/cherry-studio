import type { DiagnosticProcessingStatus } from '@shared/data/types/diagnosticReport'

export const DIAGNOSTIC_STATUS_TRANSLATION_KEYS: Record<DiagnosticProcessingStatus | 'unavailable', string> = {
  pending: 'settings.about.diagnostics.status.pending',
  unprocessed: 'settings.about.diagnostics.status.unprocessed',
  investigating: 'settings.about.diagnostics.status.investigating',
  resolved: 'settings.about.diagnostics.status.resolved',
  closed: 'settings.about.diagnostics.status.closed',
  unavailable: 'settings.about.diagnostics.status.unavailable'
}
