import type { ItemId, JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import type { ScriptedReply } from '../contract/harness'
import { isFields } from '../core/args'
import type { JobKind, JobSpec, TurnInput, TxOp } from '../core/decisions'
import { decodeEntry } from '../core/entryCodec'
import type {
  CallKey,
  ChildFacts,
  ConversationFacts,
  GateFacts,
  HistoryEntry,
  LiveFacts,
  PlanState,
  PolicyRecord,
  RunEndFacts,
  ToolCallFact,
  ToolResultFact,
  UsageFact
} from '../core/facts'
import type { Key } from '../core/keys'
import { FORK_PLACEHOLDER_RESULT } from '../core/subagents/subagentText'
import type {
  ContextFilterHandler,
  GateHandlers,
  JobHandler,
  LifecycleHandlers,
  MessageResult,
  RequestMeterHandler,
  StartResult,
  ToolDefinition
} from '../ports/harness'

export type Lineage = ConversationFacts['lineage']
export type Seed = (thread: ThreadId, lineage: Lineage) => readonly ScriptedReply[]
/** The parent run whose tool call spawned a foreground child; stopping that run stops the child. */
export type Owner = { readonly thread: ThreadId; readonly run: number }
/** How a run ended: what the conversation reports as `live.runEnd` and what `awaitAnswer` answers. */
export type RunEnding = { readonly live: NonNullable<LiveFacts['runEnd']>['outcome']; readonly answer: RunEndFacts }
/** A history entry with the run that wrote it. */
export type StoredEntry = { readonly entry: HistoryEntry; readonly run?: number }
export type Submission = {
  readonly input: TurnInput
  readonly admission: StartResult | MessageResult
  state: 'queued' | 'running' | 'settled' | 'withdrawn'
  /** The run the input started or joined. */
  run?: number
}
export type ActiveRun = { readonly run: number; readonly goalRound: boolean; requests: number }
export type ThreadState = {
  readonly id: ThreadId
  readonly lineage: Lineage
  readonly owner?: Owner
  readonly entries: StoredEntry[]
  readonly submissions: Map<string, Submission>
  readonly inbox: string[]
  /** Messages for the active run, placed at its next boundary. */
  readonly steer: string[]
  active?: ActiveRun
  runs: number
  readonly ends: Map<number, RunEnding>
  readonly script: ScriptedReply[]
  cursor: number
  calls: number
  /** Ids each model request saw; an observation log, not part of `persistentSnapshot`. */
  readonly requests: (readonly ItemId[])[]
}
export type JobRecord = {
  readonly key: Key
  readonly spec: JobSpec
  /** The thread whose transaction ensured the job; its `keysSeen` holds the key while the job lives. */
  readonly thread: ThreadId
  state: 'live' | 'done' | 'failed' | 'abandoned'
}
/** What survives a restart. */
export type FakeState = {
  readonly threads: Map<ThreadId, ThreadState>
  readonly memo: Map<string, JsonValue>
  readonly jobs: Map<string, JobRecord>
  /** Final arguments and replay rule of every call that reached its tool, for replay after a restart. */
  readonly intents: Map<CallKey, { readonly args: JsonValue; readonly replay: 'safe' | 'unsafe' }>
  readonly counters: { threads: number; items: number; users: number }
}

/** One run loop of the epoch that started it. */
export type Loop = { readonly abort: AbortController; readonly window: ToolCallFact[]; done: Promise<void> }
/** What a restart loses: handlers, run loops, running jobs and waiters. */
export type Epoch = {
  dead: boolean
  readonly tools: Map<string, ToolDefinition>
  readonly jobHandlers: Map<JobKind, JobHandler>
  gate?: GateHandlers
  filter?: ContextFilterHandler
  meter?: RequestMeterHandler
  lifecycle?: LifecycleHandlers
  readonly loops: Map<ThreadId, Loop>
  readonly jobRuns: Map<string, Promise<void>>
  /** Each waiter resolves and returns true once its condition holds. */
  readonly waiters: Map<ThreadId, (() => boolean)[]>
}

/** The input kind `sendUser` submits; it enters history as a `user` entry. */
export const USER_INPUT = 'user'
export const ZERO_USAGE: UsageFact = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 }

export const createState = (): FakeState => ({
  threads: new Map(),
  memo: new Map(),
  jobs: new Map(),
  intents: new Map(),
  counters: { threads: 0, items: 0, users: 0 }
})
export const createEpoch = (): Epoch => ({
  dead: false,
  tools: new Map(),
  jobHandlers: new Map(),
  loops: new Map(),
  jobRuns: new Map(),
  waiters: new Map()
})

export function threadOf(state: FakeState, id: ThreadId): ThreadState {
  const thread = state.threads.get(id)
  if (!thread) throw new Error(`Unknown thread ${id}`)
  return thread
}

export function nextItem(state: FakeState): ItemId {
  state.counters.items += 1
  return `item-${state.counters.items}` as ItemId
}

export function addThread(state: FakeState, lineage: Lineage, seed: Seed, owner?: Owner): ThreadState {
  state.counters.threads += 1
  const id = `thread-${state.counters.threads}` as ThreadId
  const thread: ThreadState = {
    id,
    lineage,
    owner,
    entries: [],
    submissions: new Map(),
    inbox: [],
    steer: [],
    runs: 0,
    ends: new Map(),
    script: [...seed(id, lineage)],
    cursor: 0,
    calls: 0,
    requests: []
  }
  state.threads.set(id, thread)
  return thread
}

export function append(thread: ThreadState, entry: HistoryEntry): void {
  thread.entries.push({ entry, run: thread.active?.run })
}

/** The calls of the assistant entry at `at` that no later entry answers. */
export function unansweredCalls(entries: readonly StoredEntry[], at: number): readonly ToolCallFact[] {
  const reply = entries[at]?.entry
  if (reply?.kind !== 'assistant') return []
  const answered = new Set(
    entries.slice(at).flatMap(({ entry }) => (entry.kind === 'tool-result' ? [entry.callId] : []))
  )
  return reply.toolCalls.filter((call) => !answered.has(call.callId))
}
export const resultEntry = (id: ItemId, call: ToolCallFact, result: ToolResultFact): HistoryEntry => ({
  kind: 'tool-result',
  id,
  callId: call.callId,
  callKey: call.callKey,
  tool: call.name,
  ...result
})

type MarkerEntry = Extract<HistoryEntry, { kind: 'marker' }>
/** `input` as the keyed marker it stores, or undefined when it is not one; the caller assigns the id. */
function markerOf(input: TurnInput, key: string): MarkerEntry | undefined {
  const data = { ...(isFields(input.data) ? input.data : {}), key }
  const entry = decodeEntry({ id: '' as ItemId, kind: input.kind, data, text: input.text })
  return entry?.kind === 'marker' ? entry : undefined
}

/** Enters submission `key` into the active run: as its keyed marker, or as a `user` entry when it is none. */
export function appendInput(state: FakeState, thread: ThreadState, key: string): void {
  const submission = thread.submissions.get(key)!
  submission.state = 'running'
  submission.run = thread.active!.run
  const id = nextItem(state)
  const marker = markerOf(submission.input, key)
  if (marker) append(thread, { ...marker, id })
  else append(thread, { kind: 'user', id, text: submission.input.text })
}

export const isIdle = (thread: ThreadState): boolean => thread.active === undefined && thread.inbox.length === 0
/** The entry the thread's latest run began with: the first one that run wrote, its input (H2). */
export const latestStart = (thread: ThreadState): ItemId | undefined =>
  thread.entries.find(({ run }) => run === thread.runs)?.entry.id
/** The input submitted under `key` ran to the end of its run, was withdrawn, or was never recorded (a 'busy' start). */
export function inputDone(thread: ThreadState, key: string): boolean {
  const state = thread.submissions.get(key)?.state
  return state === undefined || state === 'settled' || state === 'withdrawn'
}

const MODEL_KINDS: ReadonlySet<HistoryEntry['kind']> = new Set(['user', 'assistant', 'tool-result', 'marker'])
/** The entries the model sees next: those after the last compaction that enter its context. */
export function modelEntries(thread: ThreadState): StoredEntry[] {
  const start = thread.entries.findLastIndex(({ entry }) => entry.kind === 'compaction') + 1
  return thread.entries.slice(start).filter(({ entry }) => MODEL_KINDS.has(entry.kind))
}
/** What the model sees next: its entries without those the context filter omits (H10). */
export function visibleEntries(state: FakeState, epoch: Epoch, thread: ThreadState): StoredEntry[] {
  const omitted = new Set(epoch.filter?.omit(thread.id, buildFacts(state, thread.id)))
  return modelEntries(thread).filter(({ entry }) => !omitted.has(entry.id))
}
export const modelContext = (state: FakeState, epoch: Epoch, thread: ThreadState): JsonValue[] =>
  visibleEntries(state, epoch, thread).map(({ entry }) => ({
    kind: entry.kind,
    text: 'text' in entry ? entry.text : ''
  }))

const addUsage = (a: UsageFact, b: UsageFact): UsageFact => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  totalTokens: a.totalTokens + b.totalTokens,
  costUsd: a.costUsd + b.costUsd
})
function runUsage(thread: ThreadState): UsageFact[] {
  const sums = Array.from({ length: thread.runs }, () => ZERO_USAGE)
  for (const { entry, run } of thread.entries)
    if (entry.kind === 'assistant' && run !== undefined) sums[run - 1] = addUsage(sums[run - 1], entry.usage)
  return sums
}

export function buildFacts(state: FakeState, id: ThreadId): ConversationFacts {
  const thread = threadOf(state, id)
  const last = [...thread.ends.values()].at(-1)
  const children = new Map<ThreadId, ChildFacts>()
  for (const child of state.threads.values())
    if (child.lineage.kind === 'subagent' && child.lineage.parent === id)
      children.set(child.id, {
        running: child.active !== undefined,
        runUsage: runUsage(child),
        // Never empty: a child's origin record is written with it.
        lastItem: child.entries.at(-1)!.entry.id
      })
  const keysSeen = new Set<string>()
  for (const { entry } of thread.entries)
    if ((entry.kind === 'record' || entry.kind === 'marker') && entry.key !== undefined) keysSeen.add(entry.key)
  for (const job of state.jobs.values()) if (job.state === 'live' && job.thread === id) keysSeen.add(job.key)
  return {
    thread: id,
    lineage: thread.lineage,
    history: thread.entries.map(({ entry }) => entry),
    live: {
      idle: isIdle(thread),
      leftoverInputs: thread.active ? 0 : thread.inbox.length,
      queuedUserInput: thread.inbox.some((key) => thread.submissions.get(key)?.input.kind === USER_INPUT),
      hostCallInFlight: false,
      ...(last && { runEnd: { outcome: last.live } }),
      pendingLaunches: 0
    },
    children,
    keysSeen
  }
}

export function gateFacts(thread: ThreadState, window: readonly ToolCallFact[]): GateFacts {
  let plan: PlanState | undefined
  for (const { entry } of thread.entries)
    if (entry.kind === 'record' && entry.record.type === 'plan') plan = entry.record.value
  const goalRound = thread.active?.goalRound === true
  return { plan, goalRound, callWindow: goalRound ? [...window] : [] }
}

export type CommitContext = {
  /** The tool call the transaction runs in; only a tool call can own a foreground child. */
  readonly owner?: Owner
  readonly hasJob: (kind: JobKind) => boolean
  readonly seed: Seed
}
export type Applied = {
  readonly spawned: { readonly key: Key; readonly child: ThreadId }[]
  /** Jobs this commit made live, for the caller to start. */
  readonly jobs: JobRecord[]
}

/** Checks every operation, then applies them all; throws, having written nothing, when one cannot apply. */
export function applyOps(state: FakeState, thread: ThreadId, ops: readonly TxOp[], context: CommitContext): Applied {
  const writes = ops.map((op) => prepare(state, thread, op, context))
  const applied: Applied = { spawned: [], jobs: [] }
  for (const write of writes) write(applied)
  return applied
}

const recordEntry = (state: FakeState, record: PolicyRecord, key: string): HistoryEntry => ({
  kind: 'record',
  id: nextItem(state),
  key,
  record
})

function prepare(state: FakeState, thread: ThreadId, op: TxOp, context: CommitContext): (applied: Applied) => void {
  switch (op.type) {
    case 'append-record': {
      const target = threadOf(state, op.thread)
      return () => append(target, recordEntry(state, op.record, op.key))
    }
    case 'append-quiet': {
      const target = threadOf(state, op.thread)
      if (!isIdle(target)) throw new Error(`append-quiet refused: ${op.thread} is not idle`)
      const marker = markerOf(op.input, op.key)
      if (!marker) throw new Error(`append-quiet needs a marker input, got ${op.input.kind}`)
      return () => append(target, { ...marker, id: nextItem(state) })
    }
    case 'spawn-child': {
      const { spec, key } = op
      if (spec.boundary === 'foreground' && !context.owner)
        throw new Error('A foreground child can only be spawned from a tool call')
      const copied = spec.fork ? forkedEntries(state, spec.fork.from, spec.fork.at) : []
      const parent = threadOf(state, thread)
      return (applied) => {
        const lineage: Lineage = { kind: 'subagent', parent: thread, origin: spec.origin }
        const owner = spec.boundary === 'foreground' ? context.owner : undefined
        const child = addThread(state, lineage, context.seed, owner)
        for (const { entry } of copied) append(child, { ...entry, id: nextItem(state) })
        // A fork subagent's fork point holds calls that run on in the parent; an S-j fork's open calls ended (H3).
        const placeholders = spec.fork?.from === thread ? unansweredCalls(copied, copied.length - 1) : []
        for (const call of placeholders)
          append(child, resultEntry(nextItem(state), call, { text: FORK_PLACEHOLDER_RESULT, isError: false }))
        append(child, recordEntry(state, { type: 'subagent-origin', value: spec.origin }, key))
        const record = { ...spec.record, sessionId: child.id }
        append(parent, recordEntry(state, { type: 'subagent-run', value: record }, key))
        applied.spawned.push({ key, child: child.id })
      }
    }
    case 'ensure-job': {
      if (!context.hasJob(op.job.kind)) throw new Error(`No job handler is registered for ${op.job.kind}`)
      return (applied) => {
        if (state.jobs.get(op.key)?.state === 'live') return
        const job: JobRecord = { key: op.key, spec: op.job, thread, state: 'live' }
        state.jobs.set(op.key, job)
        applied.jobs.push(job)
      }
    }
  }
}

function forkedEntries(state: FakeState, from: ThreadId, at: ItemId): readonly StoredEntry[] {
  const entries = threadOf(state, from).entries
  const end = entries.findIndex(({ entry }) => entry.id === at)
  if (end < 0) throw new Error(`Fork point ${at} is not in ${from}`)
  return entries.slice(0, end + 1)
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
/** The persistent state as sorted JSON; a deep copy, so later writes never change it. */
export function persistentSnapshot(state: FakeState): JsonValue {
  const threads = [...state.threads.values()]
    .sort((a, b) => byCodeUnit(a.id, b.id))
    .map((thread) => ({
      id: thread.id,
      lineage: thread.lineage,
      entries: thread.entries.map(({ entry }) => entry),
      submissions: [...thread.submissions]
        .sort(([a], [b]) => byCodeUnit(a, b))
        .map(([key, submission]) => ({ key, state: submission.state }))
    }))
  const memo = [...state.memo].sort(([a], [b]) => byCodeUnit(a, b))
  const jobs = [...state.jobs.values()]
    .sort((a, b) => byCodeUnit(a.key, b.key))
    .map((job) => ({ key: job.key, kind: job.spec.kind, scope: job.spec.scope, state: job.state }))
  return JSON.parse(JSON.stringify({ threads, memo, jobs }))
}
