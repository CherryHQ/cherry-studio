import type { SettingsPath } from '../data/types/settingsPath'
import {
  DOCTOR_CHECK_CATALOG,
  type DoctorAttribution,
  type DoctorBasics,
  type DoctorCheckId,
  type DoctorCheckResult,
  type DoctorCheckStatus,
  type DoctorDataClass,
  type DoctorDetail,
  type DoctorDetailVariant,
  type DoctorEvidenceItem,
  type DoctorFixId,
  type DoctorFixMeta,
  type DoctorFixRequest,
  type DoctorReport
} from '../types/doctor'

export function isDoctorCheckId(value: unknown): value is DoctorCheckId {
  return typeof value === 'string' && Object.hasOwn(DOCTOR_CHECK_CATALOG, value)
}

export function doctorFixMeta<Id extends DoctorCheckId>(checkId: Id, fixId: DoctorFixId<Id>): DoctorFixMeta {
  const meta = (DOCTOR_CHECK_CATALOG[checkId].fixes as readonly DoctorFixMeta[]).find((fix) => fix.id === fixId)
  if (!meta) throw new Error(`Check "${checkId}" declares no fix "${fixId}"`)
  return meta
}

/** Untrusted-input guard for `diagnostics.doctor.fix`: the check must exist and declare that fix. */
export function isDoctorFixRequest(value: unknown): value is DoctorFixRequest {
  if (typeof value !== 'object' || value === null) return false
  const { runId, checkId, fixId, target } = value as {
    runId?: unknown
    checkId?: unknown
    fixId?: unknown
    target?: unknown
  }
  if (typeof runId !== 'string' || runId.length === 0) return false
  if (!isDoctorCheckId(checkId) || typeof fixId !== 'string') return false
  const meta = (DOCTOR_CHECK_CATALOG[checkId].fixes as readonly DoctorFixMeta[]).find((fix) => fix.id === fixId)
  if (!meta) return false
  return meta.targeted ? typeof target === 'string' && target.length > 0 : !Object.hasOwn(value, 'target')
}

export const DOCTOR_BASICS_DATA_CLASS: Readonly<Record<keyof DoctorBasics, DoctorDataClass>> = {
  version: 'public',
  edition: 'public',
  channel: 'public',
  platform: 'public',
  arch: 'public',
  osRelease: 'public',
  runtime: 'public',
  isPackaged: 'public',
  isPortable: 'public',
  userDataPath: 'local_only'
}

export type DoctorReportView = 'display' | 'copy' | 'export' | 'upload'

/** Which data classes each view carries by default; `consent_required` joins export/upload only on opt-in. */
export const DOCTOR_VIEW_DATA_CLASSES: Readonly<Record<DoctorReportView, readonly DoctorDataClass[]>> = {
  display: ['public', 'local_only', 'consent_required'],
  copy: ['public'],
  export: ['public', 'local_only'],
  upload: ['public']
}

type DoctorProjectedCheckResult = {
  readonly id: DoctorCheckId
  readonly status: DoctorCheckStatus
  readonly durationMs: number
  readonly evidence?: readonly DoctorEvidenceItem[]
} & (
  | { readonly status: 'pass'; readonly detail?: DoctorDetail }
  | {
      readonly status: 'warn' | 'fail'
      readonly attribution: DoctorAttribution
      readonly detail: DoctorDetail
    }
  | { readonly status: 'skip'; readonly skippedBy: DoctorCheckId }
  | { readonly status: 'error' }
)

type DoctorProjectedReport = Omit<DoctorReport, 'results'> & {
  readonly results: readonly DoctorProjectedCheckResult[]
}

type DoctorProjectionOptions = { readonly consentToSensitive?: boolean }

function projectSharedResult(
  result: DoctorCheckResult,
  allowed: ReadonlySet<DoctorDataClass>
): DoctorProjectedCheckResult {
  const shared = {
    id: result.id,
    durationMs: result.durationMs,
    ...(result.evidence ? { evidence: result.evidence.filter((item) => allowed.has(item.dataClass)) } : undefined)
  }

  switch (result.status) {
    case 'pass':
      return { ...shared, status: 'pass', ...(result.detail ? { detail: result.detail } : undefined) }
    case 'warn':
    case 'fail':
      return { ...shared, status: result.status, attribution: result.attribution, detail: result.detail }
    case 'skip':
      return { ...shared, status: 'skip', skippedBy: result.skippedBy }
    case 'error':
      return { ...shared, status: 'error' }
  }
}

/**
 * Pure projection of a report onto a view. Shared views rebuild each result from an
 * allowlist so actions, developer text and raw errors cannot cross the process boundary.
 */
export function projectDoctorReport(
  report: DoctorReport,
  view: 'display' | 'export',
  options?: DoctorProjectionOptions
): DoctorReport
export function projectDoctorReport(
  report: DoctorReport,
  view: 'copy' | 'upload',
  options?: DoctorProjectionOptions
): DoctorProjectedReport
export function projectDoctorReport(
  report: DoctorReport,
  view: DoctorReportView,
  options?: DoctorProjectionOptions
): DoctorReport | DoctorProjectedReport
export function projectDoctorReport(
  report: DoctorReport,
  view: DoctorReportView,
  options: DoctorProjectionOptions = {}
): DoctorReport | DoctorProjectedReport {
  const allowed = new Set<DoctorDataClass>(DOCTOR_VIEW_DATA_CLASSES[view])
  if (options.consentToSensitive && view !== 'copy') allowed.add('consent_required')
  const basics = Object.fromEntries(
    Object.entries(report.basics).filter(([key]) => allowed.has(DOCTOR_BASICS_DATA_CLASS[key as keyof DoctorBasics]))
  ) as DoctorBasics
  const results = report.results.map((result) => {
    if (view === 'copy' || view === 'upload') return projectSharedResult(result, allowed)
    if (!result.evidence) return result
    return { ...result, evidence: result.evidence.filter((item) => allowed.has(item.dataClass)) }
  })
  return { ...report, basics, results }
}

export type DoctorPanel = 'checks' | 'export' | 'report'

/**
 * The dialog is opened from outside the renderer (Help menu, protocol links) by navigating to
 * the About settings route with this query param.
 */
export const DOCTOR_OPEN_QUERY_PARAM = 'doctor'

export function doctorSettingsPath(panel: DoctorPanel = 'checks'): SettingsPath {
  return `/settings/about?${DOCTOR_OPEN_QUERY_PARAM}=${panel}`
}

export function doctorCheckTitleKey<Id extends DoctorCheckId>(id: Id) {
  return `settings.doctor.checks.${id}.title` as const
}

export function doctorCheckDetailKey<Id extends DoctorCheckId>(id: Id, variant: DoctorDetailVariant<Id>) {
  return `settings.doctor.checks.${id}.detail.${variant}` as const
}
