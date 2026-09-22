/**
 * Types for the Prometheus skill pack's settings section.
 *
 * Deliberately separate from `shared/types/doctor.ts`: that module's `DoctorCheckId` is a closed
 * union and `DomainOfId` requires a check's domain to equal its id prefix, so `mini-*` ids cannot
 * be expressed there. These types mirror the pack's own contract (`lib/doctor/contract.md`)
 * instead, which is the documented cross-process interface.
 */

/** The pack's four outcome statuses. */
export type PrometheusCheckStatus = 'pass' | 'warn' | 'fail' | 'skip'

/** The pack's three fix statuses, plus `failed` for a repair that could not run at all. */
export type PrometheusFixStatus = 'fixed' | 'requires_relaunch' | 'refused' | 'failed'

export interface PrometheusCheckResult {
  id: string
  title: string
  status: PrometheusCheckStatus
  /** Human-readable, English, one line. Required by the pack's contract. */
  summary: string
  /** Free text; may be multi-line. Present on most non-pass outcomes. */
  detail?: string
  /** Set when the check offers a repair. Renders the Repair button. */
  fixId?: string
}

export interface PrometheusDoctorReport {
  results: PrometheusCheckResult[]
  /** The summary line was seen, so the run finished rather than dying partway. */
  complete: boolean
  /**
   * False when the doctor could not run at all (exit 2, or the pack is missing). Distinct from
   * "checks failed": nothing was learned, so the UI must not imply a clean result.
   */
  available?: boolean
}

export interface PrometheusFixOutcome {
  status: PrometheusFixStatus
  message: string
}

/** Where the skills were pushed, and whether the push is allowed here at all. */
export interface PrometheusPushState {
  status: 'idle' | 'running' | 'done' | 'failed' | 'refused'
  /** How many skills the last successful push installed. */
  count?: number
  /** ISO timestamp of the last completed push. */
  lastRunAt?: string
  /**
   * Why the push was refused. Set only for `refused`, which means the full Prometheus pack is
   * installed on this machine and the app must not copy its own skills over it.
   */
  reason?: string
  /** The full-pack markers the pack detected, shown so the refusal is auditable. */
  markers?: string[]
}
