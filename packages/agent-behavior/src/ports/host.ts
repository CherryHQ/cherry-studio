import type { JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import type { BehaviorEvent } from '../core/decisions'
import type { CallKey, ToolCallFact } from '../core/facts'
import type {
  ApprovalAnswer,
  ApprovalHostFacts,
  ApprovalOutcome,
  Attendance,
  Autonomy,
  CallRef,
  CompactionReason,
  GoalDefaults,
  ModelFacts,
  PermissionMode,
  QuestionAnswer,
  QuestionItem,
  SubagentModelCandidate,
  VerifierVerdict
} from '../core/hostFacts'

export type ApprovalRequest = { readonly call: CallRef; readonly tool: ToolCallFact; readonly reason?: string }
/**
 * P1. Ask a person whether a call may run; tell the rules how people answered before.
 *
 * @harness coding-agent Cherry's tool approval registry and approval card, asked from the `tool_call` event; `Memory`
 * is H6's in-session store, since a restart drops the pending call.
 * @harness durable `beforeTool` waits before the intent and reruns after a crash; `Memory` is `api.memo`, and the host
 * deduplicates a repeated ask by `CallRef`.
 * @harness fake Scripted answers; an ask with none queued stays pending and shows as 'pending' in `outcomes`; `Memory`
 * is the fake's persistent memo table.
 * @keys `CallRef` (thread and call key) identifies a call to the host, which persists outcomes. The gate always records
 * each answer through `Memory.remember` under `cherry.approval:<callKey>`.
 * @waits `ask` waits for a person until answered or `signal` aborts.
 */
export interface Approvals {
  facts(call: CallRef, tool: ToolCallFact): Promise<ApprovalHostFacts>
  ask(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalAnswer>
  /** [plan choice] Persisted outcomes of `calls` on `thread`; an empty list asks for every call the host knows there. */
  outcomes(thread: ThreadId, calls: readonly CallRef[]): Promise<readonly ApprovalOutcome[]>
}

export type QuestionRequest = { readonly call: CallRef; readonly questions: readonly QuestionItem[] }
/**
 * P2. Ask a person questions (AskUserQuestion).
 *
 * @harness coding-agent Today's AskUserPort; a restart does not resume the call.
 * @harness durable The tool is replay-safe and memoizes the answer; a crash while waiting asks once more.
 * @harness fake Scripted answers, pending until one is queued.
 * @keys `CallRef` identifies the call; the answer is memoized under `cherry.ask:<callKey>`.
 * @waits Waits for a person until answered or `signal` aborts.
 */
export interface Questions {
  ask(request: QuestionRequest, signal: AbortSignal): Promise<QuestionAnswer>
}

/**
 * P3. Find models by the name a person said; tell what a conversation's model is now: whether it can call tools, its
 * key and the key a child gets by default.
 *
 * @harness coding-agent Cherry's model catalog (today's `findModels` and model tool support) and the conversation's
 * model settings.
 * @harness durable The same catalog; configuring a child's run stays with the adapter (today's `SubagentPort.configure`).
 * @harness fake A fixed candidate list and one fixed answer for every conversation.
 */
export interface Models {
  find(query: string): Promise<readonly SubagentModelCandidate[]>
  /**
   * The conversation's model now, both keys non-empty. `onOpen` reads `supportsTools`; the subagent spawn tool fills
   * `CallInputs.models` with the keys before deciding.
   */
  current(
    thread: ThreadId
  ): Promise<Pick<ModelFacts, 'parentModelKey' | 'defaultChildModelKey'> & { readonly supportsTools: boolean }>
}

export type VerifyRequest = {
  readonly objective: string
  readonly claim: { readonly evidence?: string }
  readonly context: readonly JsonValue[]
}
/**
 * P4. Judge whether a goal is met.
 *
 * @harness coding-agent The host verifier over the conversation's context after replay rules.
 * @harness durable The same; the verdict is memoized so a rerun phase does not ask again.
 * @harness fake Scripted verdicts, pending until one is queued.
 * @keys `cherry.verdict:<callKey>`.
 * @waits The host owns any timeout; the package sets none.
 */
export interface Verifier {
  verify(request: VerifyRequest, signal: AbortSignal): Promise<VerifierVerdict>
}

export type OutputFile = {
  readonly name: string
  readonly content: string
  readonly key: CallKey
  readonly tool: string
}
/**
 * P5. Store an oversized output and return a path the model's read tool can open.
 *
 * @harness coding-agent Today's ToolOutputStore.
 * @harness durable The same store; it is not transactional, so a crash may leave an orphan file.
 * @harness fake An in-memory list; saving a name again returns the same path.
 * @keys `name` is content-addressed by the core's sha256, so both harnesses name one output alike and a rerun is harmless.
 */
export interface OutputStore {
  save(file: OutputFile): Promise<string>
}

export type SummaryRequest = {
  readonly reason: CompactionReason
  readonly thread: ThreadId
  readonly messages: readonly JsonValue[]
  readonly previousSummary?: string
  readonly instructions?: string
}
/**
 * P6. Write a compaction summary with the host's model.
 *
 * Its caller is an inbound compaction method Stage C adds; adapters never call `Summarizer` or build the
 * `cherry.summary:` memo name themselves.
 *
 * @harness coding-agent Before each compaction; a rejection or an empty summary cancels it.
 * @harness durable `beforeCompact` returns `{ summary }` or `{ decline: true }`; the select phase reruns after a crash.
 * @harness fake Scripted summaries; with none queued it rejects.
 * @keys The summary is memoized under `cherry.summary:<compactionKey>`.
 */
export interface Summarizer {
  summarize(request: SummaryRequest, signal: AbortSignal): Promise<string>
}

/**
 * P7. Tell the host what happened, for display only; results never reach a parent through here.
 *
 * @harness coding-agent The runtime event channel (subagent views, notices).
 * @harness durable The same host channel.
 * @harness fake Records events in order.
 */
export interface Observation {
  emit(event: BehaviorEvent): void
}

/**
 * P8. Settings read once per decision.
 *
 * @harness coding-agent Read from Cherry's preferences at decision time.
 * @harness durable The same reads; nothing is stored in the harness.
 * @harness fake A snapshot the test replaces.
 */
export interface Settings {
  goalDefaults(): GoalDefaults
  autonomy(): Autonomy
  permissionMode(thread: ThreadId): PermissionMode
  attendance(thread: ThreadId): Attendance
  maxBackground(): number
  offloadThreshold(): number
}

/** The host side (design §6.3); `Workspaces` arrives with the worktree PR. */
export interface HostPorts {
  readonly approvals: Approvals
  readonly questions: Questions
  readonly models: Models
  readonly verifier: Verifier
  readonly outputStore: OutputStore
  readonly summarizer: Summarizer
  readonly observation: Observation
  readonly settings: Settings
}
