import {
  DOCTOR_CHECK_CATALOG,
  DOCTOR_CHECK_IDS,
  type DoctorAction,
  type DoctorCheckId,
  type DoctorCheckResult,
  type DoctorCheckStatus,
  type DoctorReport,
  type DoctorRunTier,
  type DoctorState
} from '@shared/types/doctor'

export type DisplayedDoctorDomain = (typeof DOCTOR_CHECK_CATALOG)[DoctorCheckId]['domain']
export type DoctorRowStatus = DoctorCheckStatus | 'pending'
export type DoctorGroupStatus = 'pass' | 'warn' | 'fail' | 'running' | 'neutral'

export interface DoctorRowViewModel {
  readonly id: DoctorCheckId
  readonly domain: DisplayedDoctorDomain
  readonly status: DoctorRowStatus
  readonly result?: DoctorCheckResult
  readonly actions: readonly DoctorAction[]
  readonly actionsDisabled: boolean
}

export interface DoctorGroupViewModel {
  readonly domain: DisplayedDoctorDomain
  readonly status: DoctorGroupStatus
  readonly rows: readonly DoctorRowViewModel[]
}

export interface DoctorViewModel {
  readonly status: DoctorState['status']
  readonly tier?: DoctorRunTier
  readonly report?: DoctorReport
  readonly rows: readonly DoctorRowViewModel[]
  readonly groups: readonly DoctorGroupViewModel[]
  readonly problemCount: number
  readonly summary: {
    readonly userFixable: number
    readonly appBug: number
    readonly transient: number
    readonly error: number
    readonly skip: number
  }
  readonly canCancel: boolean
  readonly isStale: boolean
}

export function canCancelDoctorRun(state: DoctorState): state is Extract<DoctorState, { status: 'running' }> {
  return state.status === 'running'
}

const DOMAIN_ORDER = [...new Set(DOCTOR_CHECK_IDS.map((id) => DOCTOR_CHECK_CATALOG[id].domain))]

function resultActions(result: DoctorCheckResult): readonly DoctorAction[] {
  if (result.status !== 'warn' && result.status !== 'fail') return []
  return result.actions
}

function groupStatus(rows: readonly DoctorRowViewModel[]): DoctorGroupStatus {
  if (rows.some((row) => row.status === 'fail' || row.status === 'error')) return 'fail'
  if (rows.some((row) => row.status === 'warn')) return 'warn'
  if (rows.some((row) => row.status === 'pending')) return 'running'
  if (rows.every((row) => row.status === 'pass')) return 'pass'
  return 'neutral'
}

function rowsForState(state: DoctorState, isStale: boolean): readonly DoctorRowViewModel[] {
  if (state.status === 'idle' || state.status === 'canceled') return []

  if (state.status === 'completed') {
    const resultById = new Map(state.report.results.map((result) => [result.id, result]))
    return DOCTOR_CHECK_IDS.flatMap((id) => {
      const result = resultById.get(id)
      return result
        ? [
            {
              id,
              domain: DOCTOR_CHECK_CATALOG[id].domain,
              status: result.status,
              result,
              actions: resultActions(result),
              actionsDisabled: isStale
            }
          ]
        : []
    })
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

export function defaultExpandedDoctorDomains(
  groups: readonly DoctorGroupViewModel[]
): readonly DisplayedDoctorDomain[] {
  return groups.filter((group) => group.rows.some(isDoctorRowExpandedByDefault)).map((group) => group.domain)
}

export function isDoctorRowExpandedByDefault(row: DoctorRowViewModel): boolean {
  return (
    row.status === 'warn' ||
    row.status === 'fail' ||
    row.status === 'error' ||
    row.status === 'skip' ||
    row.actions.length > 0
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
  const summary = rows.reduce(
    (counts, row) => {
      const result = row.result
      if (!result) return counts
      if (result.status === 'warn' || result.status === 'fail') {
        const key =
          result.attribution === 'user-fixable'
            ? 'userFixable'
            : result.attribution === 'app-bug'
              ? 'appBug'
              : 'transient'
        counts[key] += 1
      } else if (result.status === 'error') {
        counts.error += 1
      } else if (result.status === 'skip') {
        counts.skip += 1
      }
      return counts
    },
    { userFixable: 0, appBug: 0, transient: 0, error: 0, skip: 0 }
  )

  return {
    status: state.status,
    tier: state.status === 'running' ? state.tier : report?.tier,
    report,
    rows,
    groups,
    problemCount: rows.filter((row) => row.status === 'warn' || row.status === 'fail').length,
    summary,
    canCancel: canCancelDoctorRun(state),
    isStale
  }
}
