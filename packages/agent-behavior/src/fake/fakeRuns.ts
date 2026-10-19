import type { ItemId, ThreadId } from '@cherrystudio/agent-runtime'

import type { ScriptedReply } from '../contract/harness'
import type { TurnInput } from '../core/decisions'
import {
  callKeyOf,
  ENTRY_KINDS,
  type GateCall,
  type HistoryEntry,
  type ToolCallFact,
  type ToolResultFact
} from '../core/facts'
import type {
  BoundPorts,
  GateVerdict,
  MessageResult,
  RequestAllowance,
  RetractResult,
  StartResult,
  ToolDefinition
} from '../ports/harness'
import {
  type ActiveRun,
  append,
  appendInput,
  buildFacts,
  type Epoch,
  type FakeState,
  gateFacts,
  type Loop,
  modelEntries,
  nextItem,
  type Owner,
  type RunEnding,
  type ThreadState,
  ZERO_USAGE
} from './fakeState'
import { replyAt } from './scriptedModel'

/** What the run loop needs from the harness. */
export interface RunHost {
  readonly state: FakeState
  /** Restored runs a stop marked before resume (H12); like the state, the marks survive restarts. */
  readonly stopMarks: WeakSet<ActiveRun>
  /** The live epoch; every restart replaces it. */
  epoch(): Epoch
  alive(epoch: Epoch): boolean
  /** Counts one await point; never settles once `epoch` is dead, including when the armed crash fires here. */
  point(epoch: Epoch): Promise<void>
  /** Ports bound to one tool call, which `close` ends. */
  toolScope(epoch: Epoch, owner: Owner): { readonly ports: BoundPorts; close(): void }
}

/** What dead-epoch work awaits: a crashed process never answers. */
export const never = <T>(): Promise<T> => new Promise<T>(() => {})

const ABORTED: ToolResultFact = { isError: true, text: 'Tool call aborted' }
const INTERRUPTED: ToolResultFact = {
  isError: true,
  text: 'Tool call interrupted by a restart and may have partially run'
}
const LIVE = { completed: 'completed', failed: 'error', limit_reached: 'error', aborted: 'aborted' } as const

/** H2 admission: a repeated key returns its first answer; while a run is active, 'busy' and nothing recorded. */
export function start(host: RunHost, thread: ThreadState, input: TurnInput, key: string): StartResult {
  const existing = thread.submissions.get(key)
  if (existing) return existing.admission as StartResult
  return thread.active ? 'busy' : submit(host, thread, key, input)
}

/** Queues input behind the inbox; with no active run, the oldest queued input starts. */
export function submit(host: RunHost, thread: ThreadState, key: string, input: TurnInput): StartResult {
  const admission = thread.active !== undefined || thread.inbox.length > 0 ? 'queued' : 'started'
  thread.submissions.set(key, { input, admission, state: 'queued' })
  thread.inbox.push(key)
  drain(host, thread)
  return admission
}

/** H3: a running child takes the message at its next boundary; an idle one starts a run with it. */
export function message(host: RunHost, thread: ThreadState, input: TurnInput, key: string): MessageResult {
  const existing = thread.submissions.get(key)
  if (existing) return existing.admission as MessageResult
  const active = thread.active
  const admission: MessageResult = active
    ? { run: active.run, status: 'queued' }
    : { run: thread.runs + 1, status: 'started' }
  thread.submissions.set(key, { input, admission, state: 'queued' })
  if (active) thread.steer.push(key)
  else startRun(host, thread, key)
  return admission
}

export function retract(host: RunHost, thread: ThreadState, key: string): RetractResult {
  const submission = thread.submissions.get(key)
  if (!submission) return 'not-found'
  if (submission.state === 'running') return 'already-started'
  if (submission.state === 'settled') return 'settled'
  submission.state = 'withdrawn'
  remove(thread.inbox, key)
  remove(thread.steer, key)
  wake(host.epoch(), thread.id)
  return 'withdrawn'
}

/**
 * Withdraws queued input, aborts the active run together with the foreground children its calls own, and resolves
 * once that run ended. A restored run that has not resumed yet (H12's stop before resume) is only marked, with those
 * children, like Durable's `abortTask`; it stays active until `resumeRun` ends it.
 */
export async function stopRun(host: RunHost, thread: ThreadState): Promise<void> {
  const epoch = host.epoch()
  for (const key of [...thread.inbox.splice(0), ...thread.steer.splice(0)])
    thread.submissions.get(key)!.state = 'withdrawn'
  wake(epoch, thread.id)
  const active = thread.active
  if (!active) return
  const loop = epoch.loops.get(thread.id)
  if (loop) loop.abort.abort()
  else host.stopMarks.add(active)
  const owned = [...host.state.threads.values()].filter(
    (child) => child.owner?.thread === thread.id && child.owner.run === active.run
  )
  await Promise.all(owned.map((child) => stopRun(host, child)))
  return loop?.done
}

/**
 * Continues a run a restart cut: its open tool calls first, under the replay rules, then the loop. A run marked by a
 * stop before resume ends as aborted instead, its open calls aborted and none rerun.
 */
export function resumeRun(host: RunHost, thread: ThreadState): void {
  const epoch = host.epoch()
  if (!host.stopMarks.has(thread.active!)) launch(host, thread, true)
  else if (host.alive(epoch)) {
    for (const call of openCalls(thread)) append(thread, resultEntry(nextItem(host.state), call, ABORTED))
    finish(host, epoch, thread, ending(thread, 'aborted'))
  }
}

/** Resolves once `ready()` holds; checked now and after every change to the thread's runs or queued input. */
export function waitFor(epoch: Epoch, thread: ThreadId, ready: () => boolean): Promise<void> {
  if (ready()) return Promise.resolve()
  return new Promise((resolve) => {
    const waiters = epoch.waiters.get(thread) ?? []
    waiters.push(() => {
      if (!ready()) return false
      resolve()
      return true
    })
    epoch.waiters.set(thread, waiters)
  })
}

function wake(epoch: Epoch, thread: ThreadId): void {
  const waiters = epoch.waiters.get(thread)
  if (waiters)
    epoch.waiters.set(
      thread,
      waiters.filter((waiter) => !waiter())
    )
}

function remove(list: string[], key: string): void {
  const at = list.indexOf(key)
  if (at >= 0) list.splice(at, 1)
}

function drain(host: RunHost, thread: ThreadState): void {
  const next = thread.active ? undefined : thread.inbox.shift()
  if (next !== undefined) startRun(host, thread, next)
}

function startRun(host: RunHost, thread: ThreadState, key: string): void {
  thread.runs += 1
  const goalRound = thread.submissions.get(key)!.input.kind === ENTRY_KINDS.goalRound
  thread.active = { run: thread.runs, goalRound, requests: 0 }
  appendInput(host.state, thread, key)
  launch(host, thread, false)
}

function launch(host: RunHost, thread: ThreadState, resuming: boolean): void {
  const epoch = host.epoch()
  const loop: Loop = { abort: new AbortController(), window: [], done: Promise.resolve() }
  epoch.loops.set(thread.id, loop)
  loop.done = turn(host, epoch, thread, loop, resuming).then((end) =>
    host.alive(epoch) ? finish(host, epoch, thread, end) : never()
  )
}

function finish(host: RunHost, epoch: Epoch, thread: ThreadState, end: RunEnding): void {
  const { run } = thread.active!
  thread.ends.set(run, end)
  thread.active = undefined
  for (const submission of thread.submissions.values())
    if (submission.run === run && submission.state === 'running') submission.state = 'settled'
  // Messages that missed the run's last boundary stay queued, like inbox items after a failure (DP K6).
  thread.inbox.push(...thread.steer.splice(0))
  epoch.loops.delete(thread.id)
  if (end.live === 'completed') drain(host, thread)
  wake(epoch, thread.id)
}

/** Model requests and tool calls until the run ends; every write first checks that the epoch still lives. */
async function turn(
  host: RunHost,
  epoch: Epoch,
  thread: ThreadState,
  loop: Loop,
  resuming: boolean
): Promise<RunEnding> {
  const { state } = host
  const active = thread.active!
  const open = resuming ? openCalls(thread) : []
  if (open.length > 0) {
    const ended = await runCalls(host, epoch, thread, loop, open, true)
    if (!host.alive(epoch)) return never()
    if (ended) return ended
    placeSteer(state, thread)
  }
  for (;;) {
    await host.point(epoch)
    if (!host.alive(epoch)) return never()
    if (loop.abort.signal.aborted) return ending(thread, 'aborted')
    const lineage = thread.lineage.kind === 'subagent' ? 'child' : 'root'
    const allowance: RequestAllowance = epoch.meter?.allow(thread.id, active.requests, lineage) ?? { ok: true }
    if (!allowance.ok) return fail(state, thread, 'limit_reached', allowance.text)
    const omitted = new Set(epoch.filter?.omit(thread.id, buildFacts(state, thread.id)))
    thread.requests.push(modelEntries(thread).flatMap(({ entry }) => (omitted.has(entry.id) ? [] : [entry.id])))
    // The cursor moves in the same step that records the reply, so a replay never skips or repeats one.
    const reply = replyAt(thread.script, thread.cursor)
    thread.cursor += 1
    active.requests += 1
    if ('error' in reply) return fail(state, thread, 'failed', reply.error)
    const calls = appendReply(state, thread, reply)
    const ended = await runCalls(host, epoch, thread, loop, calls, false)
    if (!host.alive(epoch)) return never()
    if (ended) return ended
    if (!placeSteer(state, thread) && calls.length === 0) return ending(thread, 'completed')
  }
}

/** Runs `calls` in order and records each result; once the run is aborted the rest get aborted results. */
async function runCalls(
  host: RunHost,
  epoch: Epoch,
  thread: ThreadState,
  loop: Loop,
  calls: readonly ToolCallFact[],
  replaying: boolean
): Promise<RunEnding | undefined> {
  const { signal } = loop.abort
  for (const call of calls) {
    if (!signal.aborted) await host.point(epoch)
    if (!host.alive(epoch)) return never()
    const result = signal.aborted ? ABORTED : await callTool(host, epoch, thread, loop, call, replaying)
    if (!host.alive(epoch)) return never()
    append(thread, resultEntry(nextItem(host.state), call, result))
  }
  return signal.aborted ? ending(thread, 'aborted') : undefined
}

/** One call through the gate; after a restart a recorded call reruns with its final arguments or reports it was cut. */
async function callTool(
  host: RunHost,
  epoch: Epoch,
  thread: ThreadState,
  loop: Loop,
  call: ToolCallFact,
  replaying: boolean
): Promise<ToolResultFact> {
  const key = call.callKey
  const intent = replaying ? host.state.intents.get(key) : undefined
  if (intent?.replay === 'unsafe') return INTERRUPTED
  const scope = host.toolScope(epoch, { thread: thread.id, run: thread.active!.run })
  try {
    // The fake makes no nested calls.
    let gated: GateCall = {
      key,
      thread: thread.id,
      tool: call.name,
      args: intent ? intent.args : call.args,
      nested: false
    }
    if (!intent) {
      loop.window.push(call)
      const verdict: GateVerdict = (await epoch.gate?.before(gated, gateFacts(thread, loop.window), scope.ports)) ?? {}
      if (!host.alive(epoch)) return never()
      if (verdict.block !== undefined) return { isError: true, text: `Tool call blocked: ${verdict.block}` }
      if (verdict.args !== undefined) gated = { ...gated, args: verdict.args }
    }
    const found = epoch.tools.get(call.name)
    const tool = thread.lineage.kind === 'subagent' && found?.availability === 'parent-only' ? undefined : found
    if (!tool) return { isError: true, text: `No tool named ${call.name} is registered` }
    host.state.intents.set(key, { args: gated.args, replay: tool.replay })
    const result = await execute(tool, gated, loop.abort.signal, scope.ports)
    if (!host.alive(epoch)) return never()
    return (await epoch.gate?.after(gated, result, scope.ports)) ?? result
  } finally {
    scope.close()
  }
}

/** A rejected `run` becomes an error result and the run goes on. */
async function execute(
  tool: ToolDefinition,
  call: GateCall,
  signal: AbortSignal,
  ports: BoundPorts
): Promise<ToolResultFact> {
  try {
    const { text, isError, details } = await tool.run(
      { key: call.key, thread: call.thread, args: call.args, signal },
      ports
    )
    return details === undefined ? { text, isError } : { text, isError, details }
  } catch (error) {
    return { isError: true, text: error instanceof Error ? error.message : String(error) }
  }
}

/** The calls of the active run's last reply that have no result yet. */
function openCalls(thread: ThreadState): readonly ToolCallFact[] {
  const at = thread.entries.findLastIndex(({ entry, run }) => entry.kind === 'assistant' && run === thread.active?.run)
  const reply = thread.entries[at]?.entry
  if (reply?.kind !== 'assistant') return []
  const answered = new Set(
    thread.entries.slice(at).flatMap(({ entry }) => (entry.kind === 'tool-result' ? [entry.callId] : []))
  )
  return reply.toolCalls.filter((call) => !answered.has(call.callId))
}

function appendReply(
  state: FakeState,
  thread: ThreadState,
  reply: Exclude<ScriptedReply, { readonly error: string }>
): readonly ToolCallFact[] {
  const toolCalls = (reply.toolCalls ?? []).map(({ name, args }): ToolCallFact => {
    thread.calls += 1
    const callId = `call-${thread.calls}`
    return { callId, callKey: callKeyOf(`${thread.id}:${callId}`), name, args }
  })
  const stop = toolCalls.length > 0 ? 'toolUse' : 'stop'
  const usage = reply.usage ?? ZERO_USAGE
  append(thread, { kind: 'assistant', id: nextItem(state), text: reply.text, toolCalls, usage, stop })
  return toolCalls
}

function placeSteer(state: FakeState, thread: ThreadState): boolean {
  const keys = thread.steer.splice(0)
  for (const key of keys) appendInput(state, thread, key)
  return keys.length > 0
}

const resultEntry = (id: ItemId, call: ToolCallFact, result: ToolResultFact): HistoryEntry => ({
  kind: 'tool-result',
  id,
  callId: call.callId,
  callKey: call.callKey,
  tool: call.name,
  ...result
})

function fail(state: FakeState, thread: ThreadState, outcome: 'failed' | 'limit_reached', error: string): RunEnding {
  append(thread, {
    kind: 'assistant',
    id: nextItem(state),
    text: '',
    toolCalls: [],
    usage: ZERO_USAGE,
    stop: 'error',
    error
  })
  return ending(thread, outcome, error)
}

/** The answer carries the text of the run's last reply. */
function ending(thread: ThreadState, outcome: keyof typeof LIVE, error?: string): RunEnding {
  const last = thread.entries.findLast(({ entry, run }) => entry.kind === 'assistant' && run === thread.active?.run)
  const text = last?.entry.kind === 'assistant' ? last.entry.text : ''
  return { live: LIVE[outcome], answer: error === undefined ? { outcome, text } : { outcome, text, error } }
}
