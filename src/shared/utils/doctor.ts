import type { SettingsPath } from '../data/types/settingsPath'
import {
  DOCTOR_CHECK_CATALOG,
  type DoctorBasics,
  type DoctorCheckId,
  type DoctorDataClass,
  type DoctorDetailVariant,
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
  const { runId, checkId, fixId } = value as { runId?: unknown; checkId?: unknown; fixId?: unknown }
  if (typeof runId !== 'string' || runId.length === 0) return false
  if (!isDoctorCheckId(checkId) || typeof fixId !== 'string') return false
  return (DOCTOR_CHECK_CATALOG[checkId].fixes as readonly DoctorFixMeta[]).some((fix) => fix.id === fixId)
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

/** Pure projection of a report onto a view: drops basics and evidence outside the allowed classes. */
export function projectDoctorReport(
  report: DoctorReport,
  view: DoctorReportView,
  options: { readonly consentToSensitive?: boolean } = {}
): DoctorReport {
  const allowed = new Set<DoctorDataClass>(DOCTOR_VIEW_DATA_CLASSES[view])
  if (options.consentToSensitive && view !== 'copy') allowed.add('consent_required')
  const basics = Object.fromEntries(
    Object.entries(report.basics).filter(([key]) => allowed.has(DOCTOR_BASICS_DATA_CLASS[key as keyof DoctorBasics]))
  ) as DoctorBasics
  const results = report.results.map((result) => {
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
