import type { SerializedError } from '@renderer/types/error'
import { classifyError, getErrorHttpStatus } from '@renderer/utils/errorClassifier'

/** Diagnostic reports skip upstream HTTP 5xx errors that classify as server failures. */
export function isDiagnosticReportEligible(error?: SerializedError): boolean {
  if (!error) return true
  const status = getErrorHttpStatus(error)
  if (status === undefined || status < 500 || status >= 600) return true
  return classifyError(error).category !== 'server'
}
