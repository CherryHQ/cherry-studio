import type { DoctorFixRequest, DoctorFixResult } from './doctor'

/**
 * A bounded write the doctor Agent may ask for. Every variant maps onto an existing validated write
 * path (DataApi PATCH handler, PreferenceService, DoctorService.fix); the Agent never gets a wider one.
 */
export type DoctorAgentWrite =
  | { readonly kind: 'data_api_patch'; readonly path: string; readonly body: Readonly<Record<string, unknown>> }
  | { readonly kind: 'preference_set'; readonly key: string; readonly value: unknown }
  | { readonly kind: 'doctor_fix'; readonly request: DoctorFixRequest }

export type DoctorAgentProposalStatus = 'pending' | 'applied' | 'failed' | 'rejected'

/** A write the Agent asked for that needs a user click before it runs. */
export interface DoctorAgentProposal {
  readonly id: string
  readonly write: DoctorAgentWrite
  /** Model-authored one-line rationale; display only. */
  readonly summary: string
  readonly status: DoctorAgentProposalStatus
  readonly error?: string
}

/** Ledger entry for a write that ran, whether autonomously or via an applied proposal. */
export interface DoctorAgentChange {
  readonly id: string
  readonly write: DoctorAgentWrite
  readonly summary: string
  /** Snapshot `undoWrite` restores; `null` when the write cannot be undone (catalog fixes). */
  readonly before: unknown
  readonly undoable: boolean
  readonly undone: boolean
  readonly appliedAt: string
  readonly proposalId?: string
}

export interface DoctorAgentRun {
  readonly runId: string
  /** The Doctor report this analysis read; proposals bound to it go stale with it. */
  readonly reportRunId: string
  readonly sessionId: string
  readonly startedAt: string
  /** Streamed assistant text, markdown. */
  readonly text: string
  /** Tool names in call order; the panel shows them while the text is still empty. */
  readonly toolCalls: readonly string[]
  readonly proposals: readonly DoctorAgentProposal[]
  readonly changes: readonly DoctorAgentChange[]
}

/** Published on `doctorAgentStateCacheKey(scope)`; one analysis per scope at a time. */
export type DoctorAgentState =
  | { readonly status: 'idle' }
  | ({ readonly status: 'running' | 'completed' | 'canceled' } & DoctorAgentRun)
  | ({ readonly status: 'failed'; readonly error: string } & DoctorAgentRun)

export type DoctorAgentStartResult =
  | { readonly status: 'started'; readonly runId: string }
  | { readonly status: 'busy'; readonly runId: string }
  /** The report is missing, expired or superseded; run the Doctor again first. */
  | { readonly status: 'stale' }
  | { readonly status: 'no_model' }

export type DoctorAgentCancelResult = { readonly status: 'canceled' | 'not_running' }

export type DoctorAgentApplyResult =
  | { readonly status: 'applied'; readonly change: DoctorAgentChange; readonly fix?: DoctorFixResult }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'stale' }

export type DoctorAgentUndoResult =
  | { readonly status: 'undone'; readonly change: DoctorAgentChange }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'stale' }
