import type { ItemId, JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import type { Effect, JobKind, JobSpec, Step, StopCause, TurnInput } from '../core/decisions'
import type { CallKey, ConversationFacts, GateCall, GateFacts, RunEndFacts, ToolResultFact } from '../core/facts'
import type { CompactionReason } from '../core/hostFacts'
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
   * `append-quiet` on a conversation that is not idle). A `spawn-child` with `fork` always reports a new conversation id
   * in `spawned`, never `fork.from` itself.
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
 * H2. Give the agent a turn, take back one that has not started, stop the current one or only the one a stop names.
 *
 * @harness coding-agent `start` sends the input with a turn trigger and deduplicates by scanning history for
 * `data.key`; a `start` while a run settles answers 'busy' and records nothing, like any `start` while a run is active,
 * so nothing continues the settling run: the caller starts again once `Waits.untilIdle` resolves at `agent_settled`.
 * `retract` withdraws the reservation; `stop` aborts the session, with `turn` only while the session's latest run began
 * with that entry.
 * @harness durable `submit({ type: 'input', whenBusy: 'reject', entry: { kind, data: { ...data, key } }, requestId: key })`:
 * `ConversationBusy` is 'busy'; an idle conversation with inbox items queues the input behind them; `retract` aborts the
 * submission; `stop` is `conversation(id).abort()`, except before resume (H12), where it is
 * `Harness.abortTask(pi.live.run.taskId)` plus `abortSubmission` for each queued input, neither of which enables
 * scheduling; with `turn`, it first checks that the latest run, `pi.live.run` or else the last one, began with that
 * entry.
 * @harness fake A per-thread inbox in front of the scripted model, with Durable's admission rules; `stop` with `turn`
 * acts only while the thread's latest run began with that entry.
 * @keys The key is the request id: the same key returns the original admission and never adds a second input; a
 * 'busy' answer records nothing, so the key stays usable; a withdrawn key is spent. `stop` takes no key: `turn` names
 * the run it may stop, so repeating a stop never reaches a later turn.
 * @waits `stop` resolves once the conversation is idle, or at once when its `turn` is no longer the latest run. Before
 * resume (H12) it ends the run a restart interrupted as aborted before any resumed work and may resolve as soon as that
 * mark is durable; until resume the stopped run and its foreground children may still appear active in the facts, so
 * `onOpen` must not decide on facts read after its own stop.
 */
export interface Turns {
  /** 'started' when idle; 'queued' behind inbox items a failed run left; 'busy', recording nothing, while a run is active. */
  start(thread: ThreadId, input: TurnInput, key: Key): Promise<StartResult>
  retract(thread: ThreadId, key: Key): Promise<RetractResult>
  /**
   * Aborts the active run, and the foreground children its tool calls own, and withdraws queued input. With `turn`,
   * only while the conversation's latest run, active or ended, is the one that began with entry `turn`; once a later
   * run has begun it does nothing.
   */
  stop(thread: ThreadId, cause: StopCause, turn?: ItemId): Promise<void>
}

export type MessageResult = { readonly run: number; readonly status: 'started' | 'queued' | 'withdrawn' }
/**
 * H3. Message a child, wait for its answer, stop it.
 *
 * A child's run is what one run-starting input begins, an input that finds the child idle; a message to a running
 * child (a steer) joins that run and never starts one: when that run ends before a boundary takes the steer, the steer
 * is withdrawn (G-C5). A steer sent through a tool call's ports is also withdrawn when that call aborts, so stopping
 * the caller's turn never waits for the child's next boundary. `ChildFacts.runUsage` partitions the child's usage by
 * these runs. Before a message starts a run, each call of the child's last assistant entry that has no result gets one
 * with `INTERRUPTED_CALL_RESULT` as its text and `isError: true`, unless that entry ended in an error or was aborted.
 *
 * @harness coding-agent `message` steers a running child and loads then continues a finished one, answering its open
 * calls first; a steer that missed the run's last boundary, or whose tool call's signal aborted, is withdrawn, not
 * carried into the next run; `awaitAnswer` follows `message_end` until the run that took the message ends; `stop`
 * aborts the child session only if its active run number is `run`.
 * @harness durable `message` is `conversation(child).submit({ whenBusy: 'followUp', requestId: key })` for an idle
 * child, after appending the results its open calls lack; a steer submits with `whenBusy: 'steer'` only while its run
 * is `pi.live.run`, and aborts the submission when that run ends before taking it or the calling tool task aborts.
 * `awaitAnswer` refetches that submission by request id, waits and reads the answer entry; `stop` checks that the
 * child's active run is `run`, then calls `conversation(child).abort()`, or before resume marks it as `Turns.stop`
 * does.
 * @harness fake Children are fake conversations; a steer waits for the child's next boundary and is withdrawn when the
 * run ends first or the calling tool's signal aborts; a message that starts a run answers the open calls first;
 * `awaitAnswer` waits for the run the message actually joined; `stop` aborts only when the fake child's active run is
 * `run`.
 * @keys `message` keys are request ids (`subagent-msg:<child>:<n>`, `subagent-steer:<call>:<run>`): the same key returns
 * the original result and adds no input, also after its run ended. `awaitAnswer` is bound to the message `key`, not to
 * `run`.
 * @waits A steer's `message` resolves once a boundary of its run took it ('queued') or it was withdrawn ('withdrawn'):
 * its run ended first, or the tool call that sent it aborted. A message that starts a run resolves at once.
 * `awaitAnswer` keeps no state: after a restart the same key re-establishes the wait, and a run that already ended
 * answers at once. It resolves with the end of the run that took message `key`; a message withdrawn before it ran
 * answers with the end of run `run`. `stop` resolves once that run has ended, or at once when it does nothing.
 */
export interface Helpers {
  /**
   * 'started' with the new run's number when the child is idle; a steer otherwise, 'queued' with the number of the
   * running run once that run took it. With `run`, the message is a steer for run `run` only: 'withdrawn' (and nothing
   * started) when that is not the child's active run, when it ends before a boundary takes the steer, or when the tool
   * call whose ports sent it aborts first.
   */
  message(child: ThreadId, input: TurnInput, key: Key, run?: number): Promise<MessageResult>
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
 * H5. Wait until a conversation has no run, or until an input submitted under a key has run to its end; waiting keeps
 * no state.
 *
 * @harness coding-agent `untilIdle` resolves at `agent_settled`, not at `agent_before_settle` or `agent_end`, and never
 * while a host call is in flight; a `start` during settle answers 'busy' (H2), so nothing continues the settling run.
 * `untilDone` follows the adapter's own submission ledger (inbox and runs) to the end of the run that took the input.
 * Neither resolves at `turn_end`, which follows every model request and its tool results.
 * @harness durable `untilIdle` reads `pi.live.run` in a commit; while it exists, `waitForTask(pi.live.run.taskId)` and
 * read it again. A run hands over to a new generation task after every tool round, and queued input starts the next
 * run in the commit that ends this one, so the wait loops until `pi.live.run` is gone. `untilDone` refetches the
 * submission by request id and waits the same way for the run it joined. Both are re-established when a phase reruns.
 * @harness fake Resolved by the fake's run loop: `untilIdle` once the thread has no active run, `untilDone` once the
 * submission settled or was withdrawn.
 * @keys `untilDone` takes the key `Turns.start` was called with, the input's request id.
 * @waits `untilIdle` resolves at once when no run is active, even while inputs a failed run left are still queued
 * (`LiveFacts.leftoverInputs`). `untilDone` resolves once the input submitted under `key` has run to its end in
 * whatever run it joined, after any inputs queued before it; at once when it was withdrawn, or when nothing was
 * submitted under `key` (a 'busy' start records nothing).
 */
export interface Waits {
  untilIdle(thread: ThreadId): Promise<void>
  untilDone(thread: ThreadId, key: Key): Promise<void>
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
 * @harness fake A fixed clock that always reads 0.
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
export type ToolOutcome = ToolResultFact
export interface ToolDefinition {
  readonly name: string
  /** [plan choice] Not in the design's draft; every harness hands it to the model. */
  readonly description: string
  readonly schema: JsonValue
  /** After a crash a 'safe' call reruns; an 'unsafe' one gets an interrupted result. */
  readonly replay: 'safe' | 'unsafe'
  readonly executionMode: 'parallel' | 'sequential'
  /**
   * `'parent-only'` tools are not registered in child conversations. Adapters filter a child's tools by this field only,
   * never by tool name.
   */
  readonly availability: 'all' | 'parent-only'
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
/** For handlers that run where the harness cannot commit (Durable's hooks): the gate and `onCompacting`. */
export type GatePorts = Pick<HarnessPorts, 'memory' | 'clock'>
export interface GateHandlers {
  /**
   * Block the call (the reason becomes its error result) or rewrite its arguments. `call.signal` aborts when the call's
   * turn stops, and whatever `before` waits for (a person's approval) is withdrawn then.
   */
  before(call: GateCall & { readonly signal: AbortSignal }, facts: GateFacts, ports: GatePorts): Promise<GateVerdict>
  /**
   * Replace the result, or keep it by returning `undefined`. `call` is the call `before` saw, `nested` included, with
   * the arguments it ran with.
   */
  after(call: GateCall, result: ToolResultFact, ports: GatePorts): Promise<ToolResultFact | undefined>
}
/**
 * H9. Before a call runs, ask the rules whether to allow it or change its arguments; after it ran, whether to replace
 * its result.
 *
 * @harness coding-agent The `tool_call` and `tool_result` events; window and plan state come from the branch; the
 * signal is the event's abort signal.
 * @harness durable `beforeTool` and `afterTool`; plan from mirrored documents; the call window from the
 * late-bound `Conversation.entries()`, or an in-process window that resets on restart (harness-limited row 5); the
 * signal is the one `beforeTool` gets, aborted with the tool task.
 * @harness fake Called by the run loop with facts computed from its log; the window is kept in memory; the signal is
 * the run's abort signal.
 * @keys The call key is `callKeyOf` applied to Durable's tool task id or to coding-agent's `<sessionId>:<toolCallId>`;
 * history carries the same key as `callKey` on the call and on its result; approvals are memoized under
 * `cherry.approval:<callKey>`.
 * @waits `before` may wait for a person through the host's `Approvals` until `call.signal` aborts; on Durable a crash
 * while waiting asks again.
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
 * @harness durable Never consulted, a declared difference: a round that started and was then withdrawn, or that a
 * restart cut before its admission, stays in history, and later model requests see its marker.
 * @harness fake Consulted before every model request; the omitted ids are absent from the request it records.
 */
export interface ContextFilter {
  /** Called during install. */
  register(handler: ContextFilterHandler): void
}

export type RequestAllowance = { readonly ok: true } | { readonly ok: false; readonly text: string }
export interface RequestMeterHandler {
  /**
   * `requestsInRun` counts the requests this run already made, compaction requests included. `lineage` is `'child'`
   * for a conversation spawned as a child and `'root'` otherwise.
   */
  allow(thread: ThreadId, requestsInRun: number, lineage: 'root' | 'child'): RequestAllowance
}
/**
 * H11. Refuse a child's next model request once its run reached the cap.
 *
 * Every conversation's requests are metered, each with its lineage, so the cap applies to children only.
 *
 * @harness coding-agent Wraps the stream function and the summarizer; a subagent session is `'child'`.
 * @harness durable The model bridge counts per session id, rebuilt from the run's entries, and fails a refused request
 * with a non-retryable `quota exceeded` error; the adapter reports such a child run as `limit_reached`. A conversation
 * with a parent is `'child'`.
 * @harness fake Counts the scripted model's requests per run; a refusal ends the run with an error carrying its text. A
 * spawned conversation is `'child'`.
 */
export interface RequestMeter {
  /** Called during install. */
  register(handler: RequestMeterHandler): void
}

/** A compaction about to happen: what the summary must cover, under a key a rerun of this compaction keeps. */
export type CompactionRequest = {
  /** Durable: the compaction task id; coding-agent: `<sessionId>:<id of the entry the compaction follows>`. */
  readonly key: string
  readonly reason: CompactionReason
  readonly messages: readonly JsonValue[]
  readonly previousSummary?: string
  readonly instructions?: string
  readonly signal: AbortSignal
}
/**
 * The summary to compact with, or a decline that cancels the compaction (D33); a decline's `reason` is the summarizer's
 * error or an empty summary, for the host to show as the compaction's failure.
 */
export type CompactionVerdict = { readonly summary: string } | { readonly decline: true; readonly reason: string }
export interface LifecycleHandlers {
  onOpen(thread: ThreadId, open: { readonly reopened: boolean }, ports: BoundPorts): Promise<void>
  onCompacting(thread: ThreadId, request: CompactionRequest, ports: GatePorts): Promise<CompactionVerdict>
  onCompacted(thread: ThreadId, ports: BoundPorts): Promise<void>
  onClose(thread: ThreadId, ports: BoundPorts): Promise<void>
}
/**
 * H12. Let the package settle a conversation when it opens, before and after it is compacted, and when it closes.
 *
 * On reopen the harness restores every conversation with its runs and jobs, and `onOpen` decides what to stop; the
 * rules stay in the package. `onOpen` calls only `ledger.*`, `turns.stop`, `helpers.stop` and `clock.now`: no submits,
 * no waits.
 * Stop before resume: a run a restart interrupted, stopped from `onOpen`, ends as aborted before any resumed work (no
 * open call reruns, no further model request), and the stop may resolve as soon as that mark is durable. Until resume
 * the stopped run and its foreground children may still appear active in the facts, so `onOpen` must not decide on
 * facts read after its own stop. No conversation's interrupted run resumes before its own `onOpen` has run.
 *
 * `onCompacting` decides a compaction before it happens: the package summarizes with the host's `Summarizer` and
 * answers with the summary or a decline, and the harness compacts only with a summary. Adapters never call
 * `Summarizer` themselves. A compaction during a run is one model request of that run: the harness asks
 * `RequestMeter.allow` first, counts it, and a refusal cancels the compaction without asking `onCompacting`.
 *
 * `onCompacted` may be called while a run is active (coding-agent's automatic compaction fires inside a run), and
 * `hostCallInFlight` may still be true when it starts. It must not `append-quiet` there: it ensures the idle driver,
 * which writes the compaction status once the conversation is idle.
 *
 * @harness coding-agent `session_start`, `session_before_compact` (cancelled on a decline, whose `reason` becomes the
 * `compaction-end` error), the end of the compaction and `session_shutdown`; runs do not resume, so there is no stop
 * before resume.
 * @harness durable The host calls `onOpen` for every conversation after `Harness.open` and `inspect()` and before
 * `resume()`. Stops there only mark (`abortTask`, `abortSubmission`), because `abort()`, `submit` and the waits enable
 * scheduling; `beforeCompact` returns `{ summary }`, or `{ decline: true }` with the `reason` reported to the host,
 * and its select phase reruns after a crash under the same task id; compaction completion is observed through a
 * watch; `close()` writes nothing.
 * @harness fake `onOpen` at creation and, on every restart, for every conversation before any resumed run or job,
 * with ports that reject every method outside the list above; a stop there only marks the restored run, which resume
 * ends as aborted, and a job ensured there starts after the last `onOpen`; `compact()` asks `onCompacting` under the
 * key `<thread>:<id of its last entry>`; `onClose` on close.
 * @keys `onCompacting` memoizes a non-empty summary under `cherry.summary:<CompactionRequest.key>`.
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
