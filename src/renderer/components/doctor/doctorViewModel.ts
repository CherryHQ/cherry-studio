import {
  DOCTOR_CHECK_CATALOG,
  DOCTOR_CHECK_IDS,
  type DoctorAction,
  type DoctorCheckId,
  type DoctorCheckResult,
  type DoctorCheckStatus,
  type DoctorDomain,
  type DoctorReport,
  type DoctorState
} from '@shared/types/doctor'

export type DoctorRowStatus = DoctorCheckStatus | 'pending'
export type DoctorGroupStatus = 'pass' | 'warn' | 'fail' | 'running' | 'neutral'

export interface DoctorRowViewModel {
  readonly id: DoctorCheckId
  readonly domain: DoctorDomain
  readonly status: DoctorRowStatus
  readonly result?: DoctorCheckResult
  readonly actions: readonly DoctorAction[]
  readonly actionsDisabled: boolean
}

export interface DoctorGroupViewModel {
  readonly domain: DoctorDomain
  readonly status: DoctorGroupStatus
  readonly rows: readonly DoctorRowViewModel[]
}

export interface DoctorViewModel {
  readonly status: DoctorState['status']
  readonly report?: DoctorReport
  readonly rows: readonly DoctorRowViewModel[]
  readonly groups: readonly DoctorGroupViewModel[]
  readonly problemCount: number
  readonly isStale: boolean
}

const DOMAIN_ORDER = [...new Set(DOCTOR_CHECK_IDS.map((id) => DOCTOR_CHECK_CATALOG[id].domain))]

function resultActions(result: DoctorCheckResult): readonly DoctorAction[] {
  if (result.status === 'skip' || result.status === 'error') return []
  return result.actions ?? []
}

function groupStatus(rows: readonly DoctorRowViewModel[]): DoctorGroupStatus {
  if (rows.some((row) => row.status === 'fail' || row.status === 'error')) return 'fail'
  if (rows.some((row) => row.status === 'warn')) return 'warn'
  if (rows.some((row) => row.status === 'pending')) return 'running'
  if (rows.some((row) => row.status === 'pass')) return 'pass'
  return 'neutral'
}

function rowsForState(state: DoctorState, isStale: boolean): readonly DoctorRowViewModel[] {
  if (state.status === 'idle' || state.status === 'canceled') return []

  if (state.status === 'completed') {
    return state.report.results.map((result) => ({
      id: result.id,
      domain: DOCTOR_CHECK_CATALOG[result.id].domain,
      status: result.status,
      result,
      actions: resultActions(result),
      actionsDisabled: isStale
    }))
  }

  const resultById = new Map(state.results.map((result) => [result.id, result]))
  return DOCTOR_CHECK_IDS.filter((id) => state.tier === 'live' || DOCTOR_CHECK_CATALOG[id].tier === 'quick').map(
    (id) => {
      const result = resultById.get(id)
      return {
        id,
        domain: DOCTOR_CHECK_CATALOG[id].domain,
        status: result?.status ?? 'pending',
        result,
        actions: result ? resultActions(result) : [],
        actionsDisabled: true
      }
    }
  )
}

export function buildDoctorViewModel(state: DoctorState, now = Date.now()): DoctorViewModel {
  const report = state.status === 'completed' ? state.report : undefined
  const isStale = report ? Date.parse(report.expiresAt) <= now : false
  const rows = rowsForState(state, isStale)
  const groups = DOMAIN_ORDER.flatMap((domain) => {
    const domainRows = rows.filter((row) => row.domain === domain)
    return domainRows.length > 0 ? [{ domain, status: groupStatus(domainRows), rows: domainRows }] : []
  })

  return {
    status: state.status,
    report,
    rows,
    groups,
    problemCount: rows.filter((row) => row.status === 'warn' || row.status === 'fail' || row.status === 'error').length,
    isStale
  }
}
