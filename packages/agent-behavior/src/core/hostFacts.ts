import type { JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import type { CallKey, GoalBudget, ToolCallFact } from './facts'

export type CallRef = { readonly thread: ThreadId; readonly key: CallKey }
export type ApprovalOutcome = {
  readonly call: CallRef
  readonly state: 'pending' | 'granted' | 'denied' | 'unavailable'
  readonly feedback?: string
}
export type ToolCategory = 'read' | 'edit' | 'meta' | 'other'
/** C10, C11: what the host knows about one call. [plan choice] PR-3c may add facts. */
export type ApprovalHostFacts = {
  readonly category: ToolCategory
  readonly disabled: boolean
  readonly autoApproved: boolean
  readonly approvalRequired: boolean
  readonly nonBypassable: boolean
  readonly withinAllowedRoots: boolean
  /** Why the SQLite guard blocks this call, when it does. */
  readonly sqliteGuard?: string
  /** Arguments after the host's rtk rewrite, when it rewrote them. */
  readonly rewrittenArgs?: JsonValue
  /** A summary of the global-install command the host's detector found in the call; absent when it found none. */
  readonly globalInstall?: string
  /** The host's destructive-command detector flagged the call. */
  readonly destructive: boolean
}
export type ApprovalAnswer =
  | { readonly kind: 'granted'; readonly args?: JsonValue }
  | { readonly kind: 'denied'; readonly feedback?: string }
  | { readonly kind: 'unavailable' }
export type QuestionOption = { readonly label: string; readonly description: string; readonly preview?: string }
export type QuestionItem = {
  readonly question: string
  readonly header: string
  readonly options: readonly QuestionOption[]
  readonly multiSelect: boolean
}
export type QuestionAnswer =
  | {
      readonly status: 'answered'
      readonly answers: { readonly [question: string]: string }
      readonly annotations?: { readonly [question: string]: { readonly notes?: string } }
    }
  | { readonly status: 'declined'; readonly feedback?: string }
  | { readonly status: 'unavailable' }
export type SubagentModelCandidate = {
  readonly key: string
  readonly provider: string
  readonly model: string
  readonly exact: boolean
}
export type ModelFacts = {
  readonly candidates: readonly SubagentModelCandidate[]
  readonly supportsTools: boolean
  /** The model key of the conversation the call runs in; the host snapshot supplies it, never empty. */
  readonly parentModelKey: string
  /** The model key a child gets when none is named; the host snapshot supplies it, never empty. */
  readonly defaultChildModelKey: string
}
export type VerifierVerdict = { readonly verdict: 'met' | 'not_met' | 'impossible'; readonly reason: string }
export type GoalDefaults = {
  readonly maxGoalRounds: number
  readonly maxGoalRoundsCeiling: number
  readonly budget?: GoalBudget
  readonly blockedAfter: number
}
export type Autonomy = 'auto' | 'confirm-each-round'
/** [plan choice] The host's current permission modes; the pending permission-mode PR may rename them. */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'auto'
export type Attendance = 'stream' | 'message' | 'unavailable'
export type CompactionReason = 'manual' | 'threshold' | 'overflow'
/** C3–C6, C14: settings read once per decision. */
export interface HostSettingsSnapshot {
  readonly goalDefaults: GoalDefaults
  readonly autonomy: Autonomy
  readonly permissionMode: PermissionMode
  readonly attendance: Attendance
  readonly maxBackground: number
  readonly offloadThreshold: number
}
/** Per-call inputs gathered from host ports before `Ledger.transact`. */
export interface CallInputs {
  readonly now: number
  readonly settings: HostSettingsSnapshot
  readonly approvals: readonly ApprovalOutcome[]
  readonly models?: ModelFacts
  readonly verdict?: VerifierVerdict
  readonly callWindow?: readonly ToolCallFact[]
  readonly args?: JsonValue
}
