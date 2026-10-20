import type { ItemId, JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import { encodeEntry } from './entryCodec'
import type {
  GoalNotice,
  MarkerFact,
  PolicyRecord,
  RoundDetails,
  SubagentOrigin,
  SubagentOutcome,
  SubagentRunRecord
} from './facts'
import type { Key } from './keys'

export type TurnInput = { readonly kind: string; readonly text: string; readonly data: JsonValue }
export type StopCause = 'goal-withdraw' | 'goal-pause' | 'goal-clear' | 'user'
/** The child's parent is the thread `Ledger.transact` was called on. */
export type ChildSpec = {
  readonly boundary: 'foreground' | 'background'
  /**
   * Fork from `from`'s history up to and including `at` (a fork subagent, or design §8.3 S-j). A fork always creates a
   * new conversation with a new id on every harness: run numbers and end-record keys are per conversation, so re-owning
   * `from` in place would collide with its earlier runs. When `from` is the transacting thread (a fork subagent), the
   * child's copy then answers each call of the `at` entry with a result whose text is `FORK_PLACEHOLDER_RESULT` and
   * `isError: false`: those calls run on in `from`. A fork of another conversation (S-j) copies that conversation's
   * open calls as they are; they ended with it, and H3 answers them as interrupted before the fork's first run.
   */
  readonly fork?: { readonly from: ThreadId; readonly at: ItemId }
  readonly origin: SubagentOrigin
  /** [plan choice] The parent's run record; the harness writes it with `sessionId` = the new child, in the same commit. */
  readonly record: Omit<SubagentRunRecord, 'sessionId'>
}
export type JobKind = 'idle-driver' | 'subagent-report'
export type JobSpec = {
  readonly kind: JobKind
  readonly scope: ThreadId
  readonly input: JsonValue
  readonly onRestart: 'abandon' | 'resume'
}
export type SubagentView = {
  readonly sessionId: ThreadId
  readonly parentToolCallId: string
  readonly description: string
  readonly status: 'running' | 'awaiting_approval' | 'finished'
  readonly outcome?: SubagentOutcome
}
/** [plan choice] Display-only events for `Observation.emit`. */
export type BehaviorEvent =
  | { readonly type: 'subagents'; readonly thread: ThreadId; readonly views: readonly SubagentView[] }
  | { readonly type: 'goal-notice'; readonly thread: ThreadId; readonly notice: GoalNotice }
  | { readonly type: 'goal-round'; readonly thread: ThreadId; readonly round: RoundDetails }
export type TxOp =
  | { readonly type: 'append-record'; readonly thread: ThreadId; readonly record: PolicyRecord; readonly key: Key }
  /** The core gives it only while `live.idle`; the harness refuses it otherwise. */
  | { readonly type: 'append-quiet'; readonly thread: ThreadId; readonly input: TurnInput; readonly key: Key }
  | { readonly type: 'spawn-child'; readonly spec: ChildSpec; readonly key: Key }
  | { readonly type: 'ensure-job'; readonly job: JobSpec; readonly key: Key }
export type Effect =
  | { readonly type: 'start-turn'; readonly thread: ThreadId; readonly input: TurnInput; readonly key: Key }
  | { readonly type: 'retract-turn'; readonly thread: ThreadId; readonly key: Key }
  /**
   * With `turn`, the entry the targeted run began with, the stop reaches that run only and never a later one (H2): a
   * stop decided again for a repeated request names the turn it first named.
   */
  | { readonly type: 'stop-turn'; readonly thread: ThreadId; readonly cause: StopCause; readonly turn?: ItemId }
  /** A steer for run `run` of `child`: it joins that run or is withdrawn, never starting one (G-C5). */
  | {
      readonly type: 'message-child'
      readonly child: ThreadId
      readonly input: TurnInput
      readonly key: Key
      readonly run: number
    }
  | { readonly type: 'stop-child'; readonly child: ThreadId; readonly run: number }
  | { readonly type: 'emit'; readonly event: BehaviorEvent }
export type Step<R extends JsonValue = JsonValue> = {
  readonly ops: readonly TxOp[]
  readonly effects: readonly Effect[]
  readonly result: R
}

/** The input that starts a turn for `marker`; the harness merges its key into `data` when it stores the entry. */
export function turnInput(marker: MarkerFact, text: string): TurnInput {
  return { ...encodeEntry(marker), text }
}
