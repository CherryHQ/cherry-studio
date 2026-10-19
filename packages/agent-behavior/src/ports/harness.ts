import type { ItemId, JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import type { Effect, JobKind, JobSpec, Step, StopCause, TurnInput } from '../core/decisions'
import type { CallKey, ConversationFacts, GateCall, GateFacts, RunEndFacts, ToolResultFact } from '../core/facts'
import type { Key } from '../core/keys'

export type TransactResult<R extends JsonValue> = {
  readonly result: R
  /** The step's effects, for the caller to run in order after the commit. */
  readonly effects: readonly Effect[]
  /** Children this commit created, by the key of their spawn-child operation. */
  readonly spawned: readonly { readonly key: Key; readonly child: ThreadId }[]
}

/**
 * H1. See what happened, decide, and commit the writes the decision asks for, together.
 *
 * @harness coding-agent One synchronous section: read the branch, call `decide`, append the entries, no await in
 * between. A spawn reserves its slot and writes the running record inside it; the session is built right after.
 * @harness durable `api.commit` in tools, `runtime.commit` in jobs, `Conversation.commit` in host entries: scan entries
 * (full lineage) and read documents first, then call `decide`, then write; records are `tx.appendEntry` with
 * `{ kind, data }`; `ensure-job` is `tx.createTask`.
 * @harness fake An in-memory log behind one lock; a throwing `decide` or an operation that cannot apply writes nothing.
 * @keys Every operation carries a key. Applied keys show in `keysSeen` of the thread they landed on: records and quiet
 * inputs as `data.key`, a spawn through the parent's run record and the child's origin record, a job on the transacting
 * thread while the job lives. Callers drop operations whose key is already seen.
 */
export interface Ledger {
  /** Full-lineage facts of `thread`. */
  read(thread: ThreadId): Promise<ConversationFacts>
  /**
   * Reads `thread`'s facts, calls `decide` synchronously, applies its operations in one commit and returns the result
   * and effects. Rejects, writing nothing, when `decide` throws or an operation cannot apply (an unknown thread, or
   * `append-quiet` on a conversation that is not idle).
   */
  transact<R extends JsonValue>(
    thread: ThreadId,
    decide: (facts: ConversationFacts) => Step<R>
  ): Promise<TransactResult<R>>
  /** What the model would see next on `thread` (after compaction), for the verifier and the summarizer. */
  modelContext(thread: ThreadId): Promise<readonly JsonValue[]>
}

export type StartResult = 'started' | 'queued' | 'busy'
export type RetractResult = 'withdrawn' | 'already-started' | 'settled' | 'not-found'
/**
 * H2. Give the agent a turn, take back one that has not started, stop the current one.
 *
 * @harness coding-agent `start` during settle continues the settle, otherwise sends the input with a turn trigger and
 * deduplicates by scanning history for `data.key`; `retract` withdraws the reservation; `stop` aborts the session.
 * @harness durable `submit({ type: 'input', whenBusy: 'reject', entry: { kind, data: { ...data, key } }, requestId: key })`:
 * `ConversationBusy` is 'busy'; an idle conversation with inbox items queues the input behind them; `retract` aborts the
 * submission; `stop` is `conversation(id).abort()`, except before resume (H12), where it is
 * `Harness.abortTask(pi.live.run.taskId)` plus `abortSubmission` for each queued input, neither of which enables
 * scheduling.
 * @harness fake A per-thread inbox in front of the scripted model, with Durable's admission rules.
 * @keys The key is the request id: the same key returns the original admission and never adds a second input; a
 * 'busy' answer records nothing, so the key stays usable; a withdrawn key is spent.
 * @waits `stop` resolves once the conversation is idle. Before resume (H12) it ends the run a restart interrupted as
 * aborted before any resumed work and may resolve as soon as that mark is durable; until resume the stopped run and its
 * foreground children may still appear active in the facts, so `onOpen` must not decide on facts read after its own
 * stop.
 */
export interface Turns {
  /** 'started' when idle; 'queued' behind inbox items a failed run left; 'busy', recording nothing, while a run is active. */
  start(thread: ThreadId, input: TurnInput, key: Key): Promise<StartResult>
  retract(thread: ThreadId, key: Key): Promise<RetractResult>
  /** Aborts the active run, and the foreground children its tool calls own, and withdraws queued input. */
  stop(thread: ThreadId, cause: StopCause): Promise<void>
}

export type MessageResult = { readonly run: number; readonly status: 'started' | 'queued' }
/**
 * H3. Message a child, wait for its answer, stop it.
 *
 * A child's run is what one run-starting input begins, an input that finds the child idle; a message to a running
 * child (a steer) joins that run. `ChildFacts.runUsage` partitions the child's usage by these runs.
 *
 * @harness coding-agent `message` steers a running child and loads then continues a finished one; `awaitAnswer`
 * follows `message_end` until the run that took the message ends; `stop` aborts the child session only if its active
 * run number is `run`.
 * @harness durable `message` is `conversation(child).submit({ whenBusy: running ? 'steer' : 'followUp', requestId: key })`;
 * `awaitAnswer` refetches that submission by request id, waits and reads the answer entry; `stop` checks that the
 * child's active run is `run`, then calls `conversation(child).abort()`, or before resume marks it as `Turns.stop` does.
 * @harness fake Children are fake conversations; a message to a running child is placed at its next boundary, or
 * carried into the next run when it missed the last one; `awaitAnswer` waits for the run the message actually joined;
 * `stop` aborts only when the fake child's active run is `run`.
 * @keys `message` keys are request ids (`subagent-msg:<child>:<n>`): the same key returns the original result and adds
 * no input, also after its run ended. `awaitAnswer` is bound to the message `key`, not to `run`.
 * @waits `awaitAnswer` keeps no state: after a restart the same key re-establishes the wait, and a run that already ended
 * answers at once. It resolves with the end of the run that took message `key`: `run` is the run the message was
 * accepted into, and when the harness carries the message into the next run, it resolves with that run's end; a message
 * withdrawn before it ran answers with the end of run `run`. `stop` resolves once that run has ended, or at once when it
 * does nothing.
 */
export interface Helpers {
  /** 'started' with the new run's number when the child is idle; 'queued' with the number of the running run otherwise. */
  message(child: ThreadId, input: TurnInput, key: Key): Promise<MessageResult>
  awaitAnswer(child: ThreadId, run: number, key: Key): Promise<RunEndFacts>
  /**
   * Stops run `run` of `child` if it is the child's active run, otherwise does nothing; a later step re-decides from
   * fresh facts.
   */
  stop(child: ThreadId, run: number): Promise<void>
}

export type JobHandler = (ports: BoundPorts, job: JobSpec) => Promise<void>
/**
 * H4. Finish what a call started after it returns, across restarts.
 *
 * @harness coding-agent An in-process promise per job; nothing is rebuilt on reopen, since runs do not resume.
 * @harness durable One `cherry.job` task definition, owned by the conversation, `background: true`, with
 * `abandonOnRestart` for 'abandon' jobs; its single phase runs the handler, which reruns safely because every step is
 * keyed. Jobs are deduplicated by op key, never by kind; an 'abandon' job created before a reopen counts as ended from
 * that reopen on, although Durable marks it only once scheduling resumes.
 * @harness fake An in-memory job table; on restart 'abandon' jobs are dropped before any `onOpen` and 'resume' jobs
 * rerun from the start after it.
 * @keys Only the `ensure-job` operation creates a job; its key stays in `keysSeen` while the job lives and leaves when
 * it finishes, fails or is abandoned. A restart abandons an `'abandon'` job from the reopen on, before `onOpen`, and
 * resumes a `'resume'` job. A key whose job ended creates a new job. The idle driver's key is
 * `keys.idleDriver(thread, n)`, where `n` counts the thread's `idle-driver-exit` records (`idleDriverGeneration`): the
 * driver's final decide, the one that decides it stops, writes its exit record under `keys.idleDriverExit(thread, n)`
 * in that same transaction. An ensure committed before that transaction is seen by the decide, so the driver goes on;
 * one committed after it computes `n + 1` and creates a new job, so no wakeup is lost.
 */
export interface Jobs {
  /** Called during install. */
  register(kind: JobKind, handler: JobHandler): void
}

/**
 * H5. Wait until a conversation has no run, or until its current run ends; waiting keeps no state.
 *
 * @harness coding-agent `untilIdle` resolves at `agent_before_settle` (completed) or `agent_end` (any other outcome),
 * never while a host call is in flight; `untilRunEnd` resolves at `agent_end`. Neither resolves at `turn_end`, which
 * follows every model request and its tool results.
 * @harness durable Read `pi.live.run` in a commit; while it exists, `waitForTask(pi.live.run.taskId)` and read it again.
 * A run hands over to a new generation task after every tool round, and queued input starts the next run in the commit
 * that ends this one, so both waits loop until `pi.live.run` is gone. Re-established when a phase reruns.
 * @harness fake Resolved by the fake's run loop once the thread has no active run.
 * @waits Both resolve at once when no run is active. `untilRunEnd` resolves when the current run ends and queued input
 * starts no other in its place; `untilIdle` resolves when no run is active, even while inputs a failed run left are
 * still queued (`LiveFacts.leftoverInputs`).
 */
export interface Waits {
  untilIdle(thread: ThreadId): Promise<void>
  untilRunEnd(thread: ThreadId): Promise<void>
}

/**
 * H6. Remember an answer from a person or a model so a restart never asks again.
 *
 * @harness coding-agent An in-session store; restarts do not resume calls, so nothing needs to outlive the session.
 * @harness durable `api.memo(name, candidate)`: persistent, first writer wins; hooks and tasks share one namespace,
 * hence the `cherry.` prefix.
 * @harness fake A map that survives simulated restarts.
 * @keys Names are memo keys from `core/keys.ts` (`cherry.approval:`, `cherry.ask:`, `cherry.verdict:`, `cherry.summary:`).
 */
export interface Memory {
  /** Returns the stored value, or runs `produce` and stores what it resolves to; a rejection stores nothing. */
  remember<T extends JsonValue>(name: Key, produce: () => Promise<T>): Promise<T>
}

/**
 * H7. Read the time. Nothing mints ids; ids derive from keys.
 *
 * @harness coding-agent `Date.now()`.
 * @harness durable `runtime.now()`, the harness clock.
 * @harness fake A manual clock that moves only when the test advances it.
 */
export interface Clock {
  /** Whole milliseconds since the epoch, non-decreasing. */
  now(): number
}

export interface ToolCall {
  readonly key: CallKey
  readonly thread: ThreadId
  readonly args: JsonValue
  readonly signal: AbortSignal
}
export type ToolOutcome = { readonly text: string; readonly isError: boolean; readonly details?: JsonValue }
export interface ToolDefinition {
  readonly name: string
  /** [plan choice] Not in the design's draft; every harness hands it to the model. */
  readonly description: string
  readonly schema: JsonValue
  /** After a crash a 'safe' call reruns; an 'unsafe' one gets an interrupted result. */
  readonly replay: 'safe' | 'unsafe'
  readonly executionMode: 'parallel' | 'sequential'
  readonly modelOnly: true
  run(call: ToolCall, ports: BoundPorts): Promise<ToolOutcome>
}
/**
 * H8. Put the package's tools on the harness.
 *
 * @harness coding-agent `pi.registerTool` with the same name, schema and execution mode.
 * @harness durable Tools of an extension installed through `HarnessOptions.registry`, declaring `replay`.
 * @harness fake Called by the fake's run loop, which applies Durable's replay rules after a restart.
 */
export interface Tools {
  /** Called during install. */
  register(tool: ToolDefinition): void
}

export type GateVerdict = { readonly block?: string; readonly args?: JsonValue }
export type GatePorts = Pick<HarnessPorts, 'memory' | 'clock'>
export interface GateHandlers {
  /** Block the call (the reason becomes its error result) or rewrite its arguments. */
  before(call: GateCall, facts: GateFacts, ports: GatePorts): Promise<GateVerdict>
  /** Replace the result, or keep it by returning `undefined`. */
  after(call: GateCall, result: ToolResultFact, ports: GatePorts): Promise<ToolResultFact | undefined>
}
/**
 * H9. Before a call runs, ask the rules whether to allow it or change its arguments; after it ran, whether to replace
 * its result.
 *
 * @harness coding-agent The `tool_call` and `tool_result` events; window and plan state come from the branch.
 * @harness durable `beforeTool` and `afterTool`; plan and lineage from mirrored documents; the call window from the
 * late-bound `Conversation.entries()`, or an in-process window that resets on restart (harness-limited row 5).
 * @harness fake Called by the run loop with facts computed from its log; the window is kept in memory.
 * @keys The call key is `callKeyOf` applied to Durable's tool task id or to coding-agent's `<sessionId>:<toolCallId>`;
 * approvals are memoized under `cherry.approval:<callKey>`.
 * @waits `before` may wait for a person through the host's `Approvals`; on Durable a crash while waiting asks again.
 */
export interface ToolGate {
  /** Called during install. */
  register(handlers: GateHandlers): void
}

export interface ContextFilterHandler {
  omit(thread: ThreadId, facts: ConversationFacts): readonly ItemId[]
}
/**
 * H10. Leave unadmitted round entries out of the next model request.
 *
 * @harness coding-agent The `context` event.
 * @harness durable Never consulted: with idle-driver rounds an unadmitted round never enters history.
 * @harness fake Consulted before every model request; the omitted ids are absent from the request it records.
 */
export interface ContextFilter {
  /** Called during install. */
  register(handler: ContextFilterHandler): void
}

export type RequestAllowance = { readonly ok: true } | { readonly ok: false; readonly text: string }
export interface RequestMeterHandler {
  /** `requestsInRun` counts the requests this run already made, compaction requests included. */
  allow(thread: ThreadId, requestsInRun: number): RequestAllowance
}
/**
 * H11. Refuse a child's next model request once its run reached the cap.
 *
 * @harness coding-agent Wraps the stream function and the summarizer.
 * @harness durable The model bridge counts per session id, rebuilt from the run's entries, and fails a refused request
 * with a non-retryable `quota exceeded` error; the adapter reports such a child run as `limit_reached`.
 * @harness fake Counts the scripted model's requests per run; a refusal ends the run with an error carrying its text.
 */
export interface RequestMeter {
  /** Called during install. */
  register(handler: RequestMeterHandler): void
}

export interface LifecycleHandlers {
  onOpen(thread: ThreadId, open: { readonly reopened: boolean }, ports: BoundPorts): Promise<void>
  onCompacted(thread: ThreadId, ports: BoundPorts): Promise<void>
  onClose(thread: ThreadId, ports: BoundPorts): Promise<void>
}
/**
 * H12. Let the package settle a conversation when it opens, after it is compacted, and when it closes.
 *
 * On reopen the harness restores every conversation with its runs and jobs, and `onOpen` decides what to stop; the
 * rules stay in the package. `onOpen` calls only `ledger.*`, `turns.stop`, `helpers.stop` and `clock.now`: no submits,
 * no waits.
 * Stop before resume: a run a restart interrupted, stopped from `onOpen`, ends as aborted before any resumed work (no
 * open call reruns, no further model request), and the stop may resolve as soon as that mark is durable. Until resume
 * the stopped run and its foreground children may still appear active in the facts, so `onOpen` must not decide on
 * facts read after its own stop. No conversation's interrupted run resumes before its own `onOpen` has run.
 *
 * @harness coding-agent `session_start`, `session_compact` and `session_shutdown`; runs do not resume, so there is no
 * stop before resume.
 * @harness durable The host calls `onOpen` for every conversation after `Harness.open` and `inspect()` and before
 * `resume()`. Stops there only mark (`abortTask`, `abortSubmission`), because `abort()`, `submit` and the waits enable
 * scheduling; compaction completion is observed through a watch; `close()` writes nothing.
 * @harness fake `onOpen` at creation and, on every restart, for every conversation before any resumed run or job,
 * with ports that reject every method outside the list above; a stop there only marks the restored run, which resume
 * ends as aborted, and a job ensured there starts after the last `onOpen`; `onClose` on close.
 */
export interface Lifecycle {
  /** Called during install. */
  register(handlers: LifecycleHandlers): void
}

/** The harness side (design §6.1–6.2), bound to the installation; each call gets its own `BoundPorts`. */
export interface HarnessPorts {
  readonly ledger: Ledger
  readonly turns: Turns
  readonly helpers: Helpers
  readonly jobs: Jobs
  readonly waits: Waits
  readonly memory: Memory
  readonly clock: Clock
  readonly tools: Tools
  readonly toolGate: ToolGate
  readonly contextFilter: ContextFilter
  readonly requestMeter: RequestMeter
  readonly lifecycle: Lifecycle
}
/** Outbound ports bound to one tool call, job run or lifecycle callback; they reject once it returns. */
export type BoundPorts = Pick<HarnessPorts, 'ledger' | 'turns' | 'helpers' | 'waits' | 'memory' | 'clock'>
/** Every harness port method as `port.method`; the contract must cover each one (guardrail 5). */
export type PortMethod = {
  [P in keyof HarnessPorts]: `${P}.${Extract<keyof HarnessPorts[P], string>}`
}[keyof HarnessPorts]
