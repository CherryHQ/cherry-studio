import type { AppErrorContext } from './appError'
import type { DoctorFixRequest, DoctorFixResult, DoctorScopeKey } from './doctor'

/** The failed message an analysis is about; `topicId` is a chat topic or `agent-session:<id>`. */
export interface DoctorMessageIncident {
  readonly topicId: string
  readonly messageId: string
  /** One attempt of this row. Callers that omit it keep the `messageId` key. */
  readonly errorId?: string
}

/**
 * A non-chat failure. The snapshot is the same `AppErrorContext` the bundle stores.
 * No topic or message id, so conversation tools must not run.
 */
export interface DoctorOperationIncident {
  readonly kind: 'operation'
  readonly context: AppErrorContext
}

/** Message incidents stay `{ topicId, messageId }`; `errorId` is optional for older callers. */
export type DoctorAgentIncident = DoctorMessageIncident | DoctorOperationIncident

/** Who wrote a stored `error`. Absent on states published before this field existed. */
export type DoctorAgentErrorSource = 'service' | 'external'

/** A run failure this service invented. `busy` and `session-invalid` are the admission reasons. */
export type DoctorAgentOwnedRunFailure =
  | { readonly kind: 'not_started'; readonly reason: 'busy' | 'session-invalid' }
  | { readonly kind: 'execution_failed' }
  | { readonly kind: 'unknown' }

/** A proposal error this service invented, rather than a message thrown by the write. */
export type DoctorAgentOwnedProposalError = 'report_superseded' | 'unknown'

/** Identity of one analysis: a scope, or a scope narrowed to one failed message. */
export type DoctorAgentKey = DoctorScopeKey | `${DoctorScopeKey}#${string}`

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
  /** Who wrote `error`. Absent on proposals published before this field existed. */
  readonly errorSource?: DoctorAgentErrorSource
  /** Set when `errorSource` is `service`. */
  readonly ownedError?: DoctorAgentOwnedProposalError
}

/** Ledger entry for a write that ran, whether autonomously or via an applied proposal. */
export interface DoctorAgentChange {
  readonly id: string
  readonly write: DoctorAgentWrite
  readonly summary: string
  /** Snapshot `undoWrite` restores; `null` when the write cannot be undone (catalog fixes). */
  readonly before: unknown
  /** Exact value observed after the write; undo only proceeds while it still matches. */
  readonly after: unknown
  readonly undoable: boolean
  readonly undone: boolean
  readonly appliedAt: string
  readonly proposalId?: string
}

export interface DoctorAgentRun {
  readonly runId: string
  readonly scope: DoctorScopeKey
  readonly incident?: DoctorAgentIncident
  /** The Doctor report this analysis read; proposals bound to it go stale with it. */
  readonly reportRunId: string
  readonly sessionId: string
  /** `providerId::modelId` the turn ran on; shown in the consultation header. */
  readonly modelId: string
  readonly startedAt: string
  /** Streamed assistant text, markdown. */
  readonly text: string
  /** Tool names in call order; the panel shows them while the text is still empty. */
  readonly toolCalls: readonly string[]
  readonly proposals: readonly DoctorAgentProposal[]
  readonly changes: readonly DoctorAgentChange[]
}

/** Published on `doctorAgentStateCacheKey(key)`; one analysis per key at a time. */
export type DoctorAgentState =
  | { readonly status: 'idle' }
  | ({ readonly status: 'running' | 'completed' | 'canceled' } & DoctorAgentRun)
  | ({
      readonly status: 'failed'
      readonly error: string
      /** Who wrote `error`. Absent on states published before this field existed. */
      readonly errorSource?: DoctorAgentErrorSource
      /** Set when `errorSource` is `service`. */
      readonly ownedFailure?: DoctorAgentOwnedRunFailure
    } & DoctorAgentRun)

export type DoctorAgentStartResult =
  | { readonly status: 'started'; readonly runId: string }
  | { readonly status: 'failed'; readonly message: string }
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
