/**
 * Error-detail popup seam. The detail service opens the popup through here; the
 * component layer registers the lazy popup module per window, so no service imports
 * a component upward (renderer-architecture §2).
 */
import type { DiagnosticReportConfig, SerializedError } from '@renderer/types/error'
import type { DiagnosisContext } from '@renderer/utils/errorDiagnosis'
import type { AppErrorContext } from '@shared/types/appError'
import type { DoctorSubjectRef } from '@shared/types/doctor'
import type { DoctorAgentIncident } from '@shared/types/doctorAgent'

export interface ErrorDetailPopupParams {
  readonly errorContext: AppErrorContext
  readonly subject: DoctorSubjectRef
  readonly incident: DoctorAgentIncident
  readonly error?: SerializedError
  readonly localizedErrorMessage: string
  readonly diagnosisContext: DiagnosisContext
  readonly diagnosticReport?: DiagnosticReportConfig
}

export interface ErrorDetailPopupModule {
  isErrorDetailHostMounted(): boolean
  /** Null when a detail is already open or no host is mounted. */
  showErrorDetailPopup(params: ErrorDetailPopupParams): Promise<void> | null
}

type ErrorDetailPopupLoader = () => Promise<ErrorDetailPopupModule>

let loader: ErrorDetailPopupLoader | undefined

/** Composition-layer registration; the registrant owns lazy-loading the popup module. */
export function registerErrorDetailPopup(fn: ErrorDetailPopupLoader): void {
  loader = fn
}

/** Undefined when this window registered no popup. */
export function loadErrorDetailPopup(): Promise<ErrorDetailPopupModule> | undefined {
  return loader?.()
}
