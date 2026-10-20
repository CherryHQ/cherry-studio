import type { ItemId, JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

/** A tool call's stable identity in the harness: Durable's tool task id; coding-agent's `<sessionId>:<toolCallId>`. */
export type CallKey = string & { readonly __callKey: true }
/** Restores a call key at the adapter boundary; throws `TypeError` for an empty or blank value. */
export function callKeyOf(raw: string): CallKey {
  if (!raw.trim()) throw new TypeError('Call keys must not be empty')
  return raw as CallKey
}

export type UsageFact = {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly totalTokens: number
  readonly costUsd: number
}
/** `callKey` is the call's `CallKey`, the same key the gate and the host's approvals see. */
export type ToolCallFact = {
  readonly callId: string
  readonly callKey: CallKey
  readonly name: string
  readonly args: JsonValue
}

/** The first eight keep today's customType (agent-runtime-pi), so stored sessions need no migration. Durable refuses only `pi.` kinds. */
export const ENTRY_KINDS = {
  goal: 'cherry.goal',
  goalRound: 'cherry.goal-round',
  goalNotice: 'cherry.goal-notice',
  subagentRun: 'cherry.subagent-state',
  subagentOrigin: 'cherry.subagent-origin',
  subagentNotification: 'cherry.subagent-notification',
  subagentStatus: 'cherry.subagent-status',
  subagentMessage: 'cherry.subagent-message',
  plan: 'cherry.plan',
  turnStop: 'cherry.turn-stop',
  idleDriverExit: 'cherry.idle-driver-exit',
  subagentSteer: 'cherry.subagent-steer'
} as const
export type EntryKind = (typeof ENTRY_KINDS)[keyof typeof ENTRY_KINDS]

export type GoalPhase = 'active' | 'paused' | 'blocked' | 'complete'
export type GoalStopCode =
  | 'complete'
  | 'model_blocked'
  | 'round_limit'
  | 'budget_exhausted'
  | 'no_progress'
  | 'approval_denied'
  | 'awaiting_approval'
  | 'needs_user_input'
  | 'provider_error'
  | 'aborted'
  | 'paused_by_user'
  | 'paused_each_round'
  | 'continuation_rejected'
  | 'unsupported_model'
export type GoalBudget = { readonly tokens?: number; readonly usd?: number }
export type GoalStop = { readonly code: GoalStopCode; readonly message?: string; readonly at: number }
/** Fields of today's `cherry.goal` data (agent-runtime-pi goalState.ts). */
export type GoalSnapshot = {
  readonly id: string
  readonly revision: number
  readonly objective: string
  readonly phase: GoalPhase
  readonly roundsStarted: number
  readonly progressRounds: number
  readonly maxGoalRounds: number
  readonly budget?: GoalBudget
  readonly tokensUsed: number
  readonly costUsed: number
  readonly wrapUpDone: boolean
  readonly armed: boolean
  readonly admittedRound?: string
  readonly lastStop?: GoalStop
  readonly createdAt: number
  readonly updatedAt: number
}
export type GoalCleared = {
  readonly id: string
  readonly revision: number
  readonly cleared: true
  readonly at: number
}
export type GoalNotice = { readonly text: string; readonly level: 'info' | 'error' }
/** `id` is the deterministic round key from `core/keys.ts` (design §7.3). */
export type RoundDetails = {
  readonly id: string
  readonly goalId: string
  readonly revision: number
  readonly round: number
  readonly kind: 'work' | 'hint' | 'wrap-up'
}

export type RunEnd = 'completed' | 'failed' | 'truncated' | 'aborted' | 'limit_reached'
export type SubagentOutcome = RunEnd | 'stopped' | 'interrupted'
export type SubagentStopper = 'model' | 'user' | 'budget'
/** Today's `cherry.subagent-state` data; `usage` is a display cache only, rules read `ChildFacts.runUsage` (R3). */
export type SubagentRunRecord = {
  readonly sessionId: ThreadId
  readonly parentToolCallId: string
  readonly description: string
  readonly fork: boolean
  readonly background: boolean
  readonly modelKey: string
  readonly run: number
  readonly status: 'running' | 'finished'
  readonly outcome?: SubagentOutcome
  readonly stoppedBy?: SubagentStopper
  readonly modelStopped?: boolean
  readonly report?: string
  readonly reason?: string
  readonly partial?: string
  readonly usage?: JsonValue
}
export type SubagentOrigin = {
  readonly parentToolCallId: string
  readonly fork: boolean
  readonly description: string
  readonly modelKey: string
}
/** One run a notification delivered; usage no longer travels with it (R3). */
export type DeliveredRun = {
  readonly sessionId: ThreadId
  readonly run: number
  readonly outcome: SubagentOutcome
  readonly stoppedBy?: SubagentStopper
}
/** [plan choice] Minimal plan state; PR-3d (plan mode) may add fields. */
export type PlanState = { readonly active: boolean; readonly at: number }

/** Never enters the model context. */
export type PolicyRecord =
  | { readonly type: 'goal'; readonly value: GoalSnapshot | GoalCleared }
  | { readonly type: 'goal-notice'; readonly value: GoalNotice }
  | { readonly type: 'subagent-run'; readonly value: SubagentRunRecord }
  | { readonly type: 'subagent-origin'; readonly value: SubagentOrigin }
  | { readonly type: 'plan'; readonly value: PlanState }
  /** `cause`: a person's stop, a `/goal` command, or the stop a reopen makes. */
  | {
      readonly type: 'turn-stop'
      readonly value: { readonly cause: 'user' | 'goal-command' | 'reopen'; readonly at: number }
    }
  /** The idle driver of `generation` stopped; written by the transaction that decided it (H4). */
  | { readonly type: 'idle-driver-exit'; readonly value: { readonly generation: number } }
  /**
   * A `message_subagent` call's steer for run `run` of child `sessionId`, written before it is sent; `digest` is the
   * hash of the text sent. A second record with `withdrawn: true` says no boundary of that run took it.
   */
  | {
      readonly type: 'subagent-steer'
      readonly value: {
        readonly sessionId: ThreadId
        readonly run: number
        readonly digest: string
        readonly withdrawn: boolean
      }
    }
/** Enters the model context. */
export type MarkerFact =
  | { readonly type: 'goal-round'; readonly round: RoundDetails }
  | { readonly type: 'subagent-notification'; readonly runs: readonly DeliveredRun[]; readonly quiet: boolean }
  | { readonly type: 'subagent-status' }
  | { readonly type: 'subagent-message' }

/** Ordered and full-lineage: entries folded by compaction or hidden by reset are included. */
export type HistoryEntry =
  | {
      readonly kind: 'user'
      readonly id: ItemId
      /** The person's message as `vcc_recall` numbers and searches it: an image appears as `[image]`. */
      readonly text: string
    }
  | {
      readonly kind: 'assistant'
      readonly id: ItemId
      /** The reply's text, its thinking left out and an image as `[image]`. */
      readonly text: string
      readonly toolCalls: readonly ToolCallFact[]
      readonly usage: UsageFact
      readonly stop: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted'
      readonly error?: string
    }
  | {
      readonly kind: 'tool-result'
      readonly id: ItemId
      readonly callId: string
      /** The `CallKey` of the call this result answers, equal to that call's `ToolCallFact.callKey`. */
      readonly callKey: CallKey
      readonly tool: string
      readonly isError: boolean
      readonly details?: JsonValue
      readonly text: string
    }
  | {
      readonly kind: 'marker'
      readonly id: ItemId
      readonly key?: string
      readonly marker: MarkerFact
      readonly text: string
    }
  | { readonly kind: 'record'; readonly id: ItemId; readonly key?: string; readonly record: PolicyRecord }
  | { readonly kind: 'compaction'; readonly id: ItemId }

/** [plan choice] No `awaitingApproval`: the adapter cannot read host approval outcomes inside its commit; the core derives it from `CallInputs.approvals`. */
export interface ChildFacts {
  /** Durable: the child's `pi.live.run` exists. */
  readonly running: boolean
  /** Index `i` is run `i + 1`: the sum of the usage on the child's own entries of that run. */
  readonly runUsage: readonly UsageFact[]
  /** The child's last history entry, where a fork of the child's whole history ends (S-j). */
  readonly lastItem: ItemId
}
export interface LiveFacts {
  /** No active run and an empty inbox (Durable: no `pi.live.run`, empty `pi.inbox`). */
  readonly idle: boolean
  /**
   * Inputs still queued while no run is active, left by a run that ended without starting the next (Durable: `pi.inbox`
   * items with no `pi.live.run`, after a failed run); 0 while a run is active. `Waits.untilIdle` does not wait for them.
   */
  readonly leftoverInputs: number
  readonly queuedUserInput: boolean
  /**
   * A host entry (prompt or compact) has been accepted but has not yet started as a run, or a compaction is in progress.
   * Only coding-agent can report true.
   */
  readonly hostCallInFlight: boolean
  /** The most recently finished run; absent until a run ends. */
  readonly runEnd?: { readonly outcome: 'completed' | 'error' | 'aborted' }
  /** coding-agent's slot reservations; always 0 on Durable and the fake. */
  readonly pendingLaunches: number
}
export interface ConversationFacts {
  readonly thread: ThreadId
  readonly lineage:
    | { readonly kind: 'root' }
    | { readonly kind: 'subagent'; readonly parent: ThreadId; readonly origin: SubagentOrigin }
  readonly history: readonly HistoryEntry[]
  readonly live: LiveFacts
  /** Direct children only. */
  readonly children: ReadonlyMap<ThreadId, ChildFacts>
  /** Keys of this thread's entries plus keys of live jobs ensured by a transaction on this thread. */
  readonly keysSeen: ReadonlySet<string>
}

/** How one child run ended, as `Helpers.awaitAnswer` reports it. */
export type RunEndFacts = { readonly outcome: RunEnd; readonly text: string; readonly error?: string }
/** [plan choice] Text and details only; images and structured content pass through the adapter untouched. */
export type ToolResultFact = { readonly text: string; readonly isError: boolean; readonly details?: JsonValue }
export type GateCall = {
  readonly key: CallKey
  readonly thread: ThreadId
  readonly tool: string
  readonly args: JsonValue
  /** Another tool made this call; `before` and `after` see the same value. */
  readonly nested: boolean
}
export type GateFacts = {
  readonly plan: PlanState | undefined
  readonly goalRound: boolean
  /** [plan choice] In a goal round: that round's calls in call order, up to and including this one; otherwise empty (C16). */
  readonly callWindow: readonly ToolCallFact[]
}
