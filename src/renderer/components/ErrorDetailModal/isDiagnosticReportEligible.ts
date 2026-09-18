import type { SerializedError } from '@renderer/types/error'
import { classifyError } from '@renderer/utils/errorClassifier'

/** Upstream 5xx / service-unavailable errors are not useful as Cherry Studio diagnostic reports. */
export function isDiagnosticReportEligible(error?: SerializedError): boolean {
  if (!error) return true
  return classifyError(error).category !== 'server'
}
