import type { JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import type { BehaviorEvent } from '../core/decisions'
import type { CallKey, ToolCallFact } from '../core/facts'
import type {
  ApprovalAnswer,
  ApprovalHostFacts,
  Attendance,
  Autonomy,
  CallRef,
  GoalDefaults,
  ModelFacts,
  PermissionMode,
  QuestionAnswer,
  QuestionItem,
  SubagentModelCandidate,
  VerifierVerdict
} from '../core/hostFacts'

/** `presentation`: show the ask inline in the conversation's stream, or as a message (from `Settings.attendance`). */
export type ApprovalRequest = {
  readonly call: CallRef
  readonly tool: ToolCallFact
  readonly presentation: 'stream' | 'message'
  readonly details?: JsonValue
}
/**
 * P1. Ask a person whether a call may run.
 *
 * Decisions never read answers back from the host: a denied or unanswerable call reaches them only as its blocked
 * result in the thread's own history, and a parent never reads its children's calls.
 *
 * @harness coding-agent Cherry's tool approval registry and approval card, asked from the `tool_call` event; `Memory`
 * is H6's in-session store, since a restart drops the pending call.
 * @harness durable `beforeTool` waits before the intent and reruns after a crash; `Memory` is `api.memo`, and the host
 * deduplicates a repeated ask by `CallRef`.
 * @keys `CallRef` (thread and call key) identifies a call to the host. The gate always records each answer through
 * `Memory.remember` under `cherry.approval:<callKey>`.
 * @waits `ask` waits for a person until answered or `signal` aborts.
 */
export interface Approvals {
  /** A child's call comes with the child's thread; answer it by the agent tool policy of its root conversation. */
  facts(call: CallRef, tool: ToolCallFact): Promise<ApprovalHostFacts>
  ask(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalAnswer>
}

export type QuestionRequest = { readonly call: CallRef; readonly questions: readonly QuestionItem[] }
/**
 * P2. Ask a person questions (AskUserQuestion).
 *
 * @harness coding-agent Today's AskUserPort; a restart does not resume the call.
 * @harness durable The tool is replay-safe and memoizes the answer; a crash while waiting asks once more.
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
 */
export interface Models {
  find(query: string, thread: ThreadId): Promise<readonly SubagentModelCandidate[]>
  /**
   * The conversation's model now, both keys non-empty. `onOpen` and `/goal` read `supportsTools`: a goal stops on a
   * model without tool calling, and `/goal` neither creates nor resumes one there. The subagent spawn tool and `/goal`
   * fill `CallInputs.models` with this answer before deciding.
   */
  current(
    thread: ThreadId
  ): Promise<Pick<ModelFacts, 'parentModelKey' | 'defaultChildModelKey'> & { readonly supportsTools: boolean }>
}

export type VerifyRequest = {
  readonly thread: ThreadId
  readonly objective: string
  readonly claim: { readonly evidence?: string }
  readonly context: readonly JsonValue[]
}
/**
 * P4. Judge whether a goal is met.
 *
 * @harness coding-agent The host verifier over the conversation's context after replay rules.
 * @harness durable The same; the verdict is memoized so a rerun phase does not ask again.
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
 * @keys `name` is content-addressed by the core's sha256, so both harnesses name one output alike and a rerun is harmless.
 */
export interface OutputStore {
  save(file: OutputFile): Promise<string>
}

/**
 * P7. Tell the host what happened, for display only; results never reach a parent through here.
 *
 * @harness coding-agent The runtime event channel (subagent views, notices).
 * @harness durable The same host channel.
 */
export interface Observation {
  emit(event: BehaviorEvent): void
}

/**
 * P8. Settings read once per decision.
 *
 * The gate reads `permissionMode` and `attendance` with the thread of the conversation that made the call, a child's
 * included; answer a child's as its root conversation's (its permission mode and whether a person attends it).
 * `attendance` is `'unavailable'` only when nobody can respond: a call that needs approval is then blocked, so
 * answering it for a child whose root has a person attending denies every such call the child makes.
 *
 * @harness coding-agent Read from Cherry's preferences at decision time.
 * @harness durable The same reads; nothing is stored in the harness.
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
  readonly observation: Observation
  readonly settings: Settings
}
