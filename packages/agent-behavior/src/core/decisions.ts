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
   * Fork from `from`'s history up to and including `at` (a fork subagent, or design §8.3 S-j). An adapter that can
   * re-own `from` in the background in place may return `from`'s own id as the child (coding-agent may; Durable cannot
   * and must fork); orchestration treats the returned id as the new child's either way.
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
/** [plan choice] Display-only events for `Observation.emit`; Stage C may add variants. */
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
  | { readonly type: 'stop-turn'; readonly thread: ThreadId; readonly cause: StopCause }
  | { readonly type: 'message-child'; readonly child: ThreadId; readonly input: TurnInput; readonly key: Key }
  | {
      readonly type: 'stop-child'
      readonly child: ThreadId
      readonly run: number
      readonly by: 'model' | 'user' | 'budget'
    }
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
