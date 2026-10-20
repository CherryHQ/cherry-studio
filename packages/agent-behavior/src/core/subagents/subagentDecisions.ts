import type { ItemId, JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import { booleanField, fieldsOf, stringField } from '../args'
import { type ChildSpec, type Effect, type Step, type TurnInput, turnInput, type TxOp } from '../decisions'
import { sha256Hex } from '../digest'
import { ensureDriver, ensureReport, type ReportInput } from '../driver/jobs'
import type {
  CallKey,
  ConversationFacts,
  PolicyRecord,
  RunEndFacts,
  SubagentOrigin,
  SubagentRunRecord,
  SubagentStopper,
  ToolResultFact
} from '../facts'
import { currentGoal, goalCounts } from '../goal/goalHistory'
import { BUDGET_REFUSAL, budgetExceeded } from '../goal/goalState'
import type { CallInputs, SubagentModelCandidate } from '../hostFacts'
import { type Key, keys, nextRun } from '../keys'
import { awaitingApproval, isLive, readSubagents, resolveChild, runningBackground, runStarted } from './subagentLedger'
import {
  capText,
  FORK_WITH_MODEL,
  IN_SUBAGENT,
  idTrailer,
  MAX_SUBAGENT_REQUESTS,
  queuedText,
  RECOVERY_HINT,
  type RunReport,
  runText,
  statusText,
  stoppedText,
  taskText,
  unknownIdText
} from './subagentText'

type Facts = ConversationFacts
type SteerRecord = Extract<PolicyRecord, { readonly type: 'subagent-steer' }>['value']
const SIMILAR = 5
const messageInput = (text: string): TurnInput => turnInput({ type: 'subagent-message' }, text)
const refuse = <R extends JsonValue>(result: R): Step<R> => ({ ops: [], effects: [], result })

/** D16: the one model the person named; several exact matches go back to the person, none is an error. */
export function resolveModel(
  query: string,
  candidates: readonly SubagentModelCandidate[]
): { readonly key: string } | { readonly text: string } {
  const exact = candidates.filter((candidate) => candidate.exact)
  const name = (candidate: SubagentModelCandidate) => `${candidate.provider} / ${candidate.model}`
  if (exact.length === 1) return { key: exact[0].key }
  if (exact.length > 1)
    return {
      text: [
        `Several models match "${query}":`,
        ...exact.map((candidate) => `- ${name(candidate)}`),
        'Ask the user which one to use, then call subagent again with the provider and model name.'
      ].join('\n')
    }
  const similar = candidates.slice(0, SIMILAR).map(name)
  return {
    text: `No enabled model with tool support matches "${query}".${similar.length > 0 ? ` Similar: ${similar.join(', ')}` : ''}`
  }
}

/** Why a background run cannot start now: the armed goal's budget is used up (X5), or every slot is taken (S-e). */
export function backgroundRefusal(facts: Facts, inputs: CallInputs): string | undefined {
  const goal = currentGoal(facts.history)
  if (goal?.phase === 'active' && goal.armed && budgetExceeded(goal, goalCounts(facts, goal.id).usage))
    return BUDGET_REFUSAL
  const running = runningBackground(facts).length + facts.live.pendingLaunches
  return running >= inputs.settings.maxBackground ? capText(running) : undefined
}

export type SpawnDecision =
  | { readonly kind: 'refused'; readonly text: string }
  /** `child` is set when this call already spawned it (a rerun); otherwise read it from `TransactResult.spawned`. */
  | {
      readonly kind: 'spawn'
      readonly key: Key
      readonly child?: ThreadId
      readonly background: boolean
      readonly fork: boolean
      readonly input: TurnInput
    }

/**
 * `subagent` (D15): foreground or background is fixed here (§15 Q1). A background spawn creates its report job in
 * the same commit; a foreground one is messaged and awaited by the calling tool. Only the last assistant entry can
 * hold the running call, so a fork starts there (Z1).
 */
export function decideSpawn(facts: Facts, inputs: CallInputs, call: CallKey): Step<SpawnDecision> {
  const args = fieldsOf(inputs.args)
  const description = (stringField(args, 'description') ?? '').trim()
  const prompt = (stringField(args, 'prompt') ?? '').trim()
  const fork = booleanField(args, 'fork') ?? false
  const background = booleanField(args, 'background') ?? false
  const key = keys.subagentSpawn(call)
  const input = messageInput(taskText(prompt))
  const spawned = facts.history.find(
    (entry) => entry.kind === 'record' && entry.record.type === 'subagent-run' && entry.key === key
  )
  if (spawned?.kind === 'record' && spawned.record.type === 'subagent-run')
    return refuse({ kind: 'spawn', key, child: spawned.record.value.sessionId, background, fork, input })
  if (facts.lineage.kind === 'subagent') return refuse({ kind: 'refused', text: IN_SUBAGENT })
  if (!description || !prompt)
    return refuse({ kind: 'refused', text: 'A subagent needs a non-empty description and prompt.' })
  const named = stringField(args, 'model')?.trim()
  if (named && fork) return refuse({ kind: 'refused', text: FORK_WITH_MODEL })
  const models = inputs.models
  if (!models)
    throw new Error('decideSpawn needs CallInputs.models (Models.current and, with a named model, Models.find)')
  const model = named ? resolveModel(named, models.candidates) : undefined
  if (model && 'text' in model) return refuse({ kind: 'refused', text: model.text })
  const refusal = background ? backgroundRefusal(facts, inputs) : undefined
  if (refusal) return refuse({ kind: 'refused', text: refusal })
  let at: ItemId | undefined
  for (const entry of facts.history) if (entry.kind === 'assistant') at = entry.id
  if (fork && !at)
    return refuse({ kind: 'refused', text: 'No assistant message holds this call, so there is nothing to fork.' })
  // S9: the named model; a fork keeps the parent's model, which shares its prompt cache; otherwise the host's default.
  const modelKey = model?.key ?? (fork ? models.parentModelKey : models.defaultChildModelKey)
  const origin: SubagentOrigin = { parentToolCallId: call, fork, description, modelKey }
  const ops: TxOp[] = [
    {
      type: 'spawn-child',
      spec: {
        boundary: background ? 'background' : 'foreground',
        ...(fork && at ? { fork: { from: facts.thread, at } } : {}),
        origin,
        record: { ...origin, background, run: 1, status: 'running' }
      },
      key
    }
  ]
  if (background) ops.push(ensureReport(facts, { runKey: key, run: 1, text: input.text }))
  return { ops, effects: [], result: { kind: 'spawn', key, background, fork, input } }
}

export type MessageDecision =
  | { readonly kind: 'refused'; readonly text: string }
  | { readonly kind: 'queued'; readonly child: ThreadId; readonly text: string }
  /**
   * The message starts run `run` in the background. `child` is unset when a finished foreground child was forked into
   * a new background child (S-j): read it from `TransactResult.spawned` under `key`. Reply with `continuedText(from, child)`.
   */
  | {
      readonly kind: 'continued'
      readonly from: string
      readonly child?: ThreadId
      readonly key: Key
      readonly run: number
    }
  /** Run `run` is being stopped: await `helpers.awaitAnswer(child, run, key)`, then decide again (its end is recorded). */
  | { readonly kind: 'stopping'; readonly child: ThreadId; readonly run: number; readonly key: Key }

/**
 * `message_subagent` (D17, S-j): a running child reads the message after its current step; a finished one continues
 * in the background as its next run. A finished background child continues in place; a finished foreground child is
 * forked from its whole history into a new background child, and later calls on the old id reach the new one
 * (`resolveChild`). A message to a run being stopped waits for that stop to be recorded; a child the user stopped
 * cannot be continued. A steer only joins a running run (G-C5): one whose first input has not arrived refuses it, and
 * when the run ends before taking it the caller records that (`decideSteerWithdrawn`) and decides again. A steer is
 * recorded before it is sent, and a rerun sends that steer again under its key instead of deciding afresh: the
 * harness answers as it first did (H3), so a steer the child took is never delivered twice.
 */
export function decideMessage(facts: Facts, inputs: CallInputs, call: CallKey): Step<MessageDecision> {
  if (facts.lineage.kind === 'subagent') return refuse({ kind: 'refused', text: IN_SUBAGENT })
  const args = fieldsOf(inputs.args)
  const id = (stringField(args, 'id') ?? '').trim()
  const message = (stringField(args, 'message') ?? '').trim()
  if (!message) return refuse({ kind: 'refused', text: 'message_subagent needs a non-empty message.' })
  const key = keys.subagentContinue(call)
  const continued = facts.history.find((entry) => entry.kind === 'record' && entry.key === key)
  if (continued?.kind === 'record' && continued.record.type === 'subagent-run') {
    const { sessionId, run } = continued.record.value
    return refuse({ kind: 'continued', from: id, child: sessionId, key, run })
  }
  const sent = pendingSteer(facts, call)
  if (sent) return steer(facts, call, sent.sessionId, sent.run, message)
  const target = resolveChild(readSubagents(facts.history), id)
  if (!target) return refuse({ kind: 'refused', text: unknownIdText(id, listed(facts, inputs)) })
  const { child, latest } = target
  if (isLive(facts, latest) && !latest.stoppedBy) {
    // A steer joins a running run only (G-C5); this one's report job has not sent its first input yet.
    if (facts.children.get(child)?.running !== true)
      return refuse({
        kind: 'refused',
        text: `Subagent ${child} has not started its run yet. Message it again once it is running.`
      })
    return steer(facts, call, child, latest.run, message)
  }
  if (latest.stoppedBy === 'user')
    return refuse({
      kind: 'refused',
      text: `Subagent ${child} was stopped by the user and cannot be continued. Start a new subagent if the work is still needed.`
    })
  // A run being stopped would drop the message: it is answered once the stop is recorded (Y5).
  if (isLive(facts, latest))
    return refuse({ kind: 'stopping', child, run: latest.run, key: keys.subagentMessage(child, latest.run) })
  const refusal = backgroundRefusal(facts, inputs)
  if (refusal) return refuse({ kind: 'refused', text: refusal })
  const interrupted = latest.outcome === 'interrupted' || latest.outcome === 'aborted'
  const text = interrupted ? `${RECOVERY_HINT}\n\n${message}` : message
  const origin: SubagentOrigin = {
    parentToolCallId: latest.parentToolCallId,
    fork: latest.fork,
    description: latest.description,
    modelKey: latest.modelKey
  }
  if (!latest.background) {
    const at = facts.children.get(child)?.lastItem
    if (!at)
      return refuse({ kind: 'refused', text: `Subagent ${child} cannot be continued: its history is not available.` })
    const spec: ChildSpec = {
      boundary: 'background',
      fork: { from: child, at },
      origin,
      record: { ...origin, background: true, run: 1, status: 'running' }
    }
    return {
      ops: [{ type: 'spawn-child', spec, key }, ensureReport(facts, { runKey: key, run: 1, text })],
      effects: [],
      result: { kind: 'continued', from: id, key, run: 1 }
    }
  }
  const run = nextRun(facts.history, child)
  const record: SubagentRunRecord = { ...origin, sessionId: child, background: true, run, status: 'running' }
  const report: ReportInput = { runKey: keys.subagentMessage(child, run), run, text, child }
  return {
    ops: [
      { type: 'append-record', thread: facts.thread, record: { type: 'subagent-run', value: record }, key },
      ensureReport(facts, report)
    ],
    effects: [],
    result: { kind: 'continued', from: id, child, key, run }
  }
}

/** The steer `call` recorded last that no withdrawal followed. */
function pendingSteer(facts: Facts, call: CallKey): SteerRecord | undefined {
  let sent: SteerRecord | undefined
  for (const entry of facts.history)
    if (
      entry.kind === 'record' &&
      entry.record.type === 'subagent-steer' &&
      entry.key === keys.subagentSteer(call, entry.record.value.run) &&
      !facts.keysSeen.has(keys.subagentSteerWithdrawn(call, entry.record.value.run))
    )
      sent = entry.record.value
  return sent
}

/** A steer for run `run` of `child`, recorded under its request key in the commit before it is sent. */
function steer(facts: Facts, call: CallKey, child: ThreadId, run: number, message: string): Step<MessageDecision> {
  const key = keys.subagentSteer(call, run)
  const value: SteerRecord = { sessionId: child, run, digest: sha256Hex(message), withdrawn: false }
  return {
    ops: [{ type: 'append-record', thread: facts.thread, record: { type: 'subagent-steer', value }, key }],
    effects: [{ type: 'message-child', child, input: messageInput(message), key, run }],
    result: { kind: 'queued', child, text: queuedText(child) }
  }
}

/**
 * The harness answered `withdrawn` for the call's steer (H3): recorded, so neither the next decision nor a rerun sends
 * it again.
 */
export function decideSteerWithdrawn(facts: Facts, call: CallKey): Step<null> {
  const sent = pendingSteer(facts, call)
  if (!sent) return refuse(null)
  return {
    ops: [
      {
        type: 'append-record',
        thread: facts.thread,
        record: { type: 'subagent-steer', value: { ...sent, withdrawn: true } },
        key: keys.subagentSteerWithdrawn(call, sent.run)
      }
    ],
    effects: [],
    result: null
  }
}

function listed(facts: Facts, inputs: CallInputs): string[] {
  return readSubagents(facts.history)
    .reverse()
    .map(({ child, latest }) => {
      const status = statusText(latest, isLive(facts, latest), awaitingApproval(inputs.approvals, child))
      return `${child} — ${latest.description} — ${status}`
    })
}

/**
 * `by` stops `record`'s run; a user's stop stays theirs while the run winds down (Y4). A run no input has reached ends
 * here as stopped (`ended`), so its report job sends nothing and nobody waits for it (G-C4); a started run gets the stop
 * record and a `stop-child` effect, and its end is recorded once it has wound down.
 */
function stopRun(
  facts: Facts,
  record: SubagentRunRecord,
  by: SubagentStopper
): { readonly ops: TxOp[]; readonly effects: Effect[]; readonly ended: boolean } {
  const { sessionId: child, run } = record
  const value: SubagentRunRecord = {
    ...record,
    stoppedBy: record.stoppedBy === 'user' ? 'user' : by,
    ...(by === 'model' ? { modelStopped: true } : {})
  }
  if (runStarted(facts, child, run) || facts.children.get(child)?.running === true)
    return {
      ops: [
        {
          type: 'append-record',
          thread: facts.thread,
          record: { type: 'subagent-run', value },
          key: keys.subagentStop(child, run, by)
        }
      ],
      effects: [{ type: 'stop-child', child, run }],
      ended: false
    }
  const ended: SubagentRunRecord = { ...value, status: 'finished', outcome: 'stopped' }
  return {
    ops: [
      {
        type: 'append-record',
        thread: facts.thread,
        record: { type: 'subagent-run', value: ended },
        key: keys.subagentEnd(child, run)
      }
    ],
    effects: [],
    ended: true
  }
}

export type StopDecision =
  | { readonly kind: 'refused'; readonly text: string }
  | { readonly kind: 'not-running'; readonly result: ToolResultFact }
  /** No input had reached the run: its end is recorded as stopped, and its report job sends none (G-C4). */
  | { readonly kind: 'ended'; readonly result: ToolResultFact }
  /** Await `helpers.awaitAnswer(child, run, key)` for the partial output, then `stoppedResult`. */
  | { readonly kind: 'stopping'; readonly child: ThreadId; readonly run: number; readonly key: Key }

/** `stop_subagent` (D18): the model gets the partial output, and no notification follows. */
export function decideStop(facts: Facts, inputs: CallInputs): Step<StopDecision> {
  if (facts.lineage.kind === 'subagent') return refuse({ kind: 'refused', text: IN_SUBAGENT })
  const id = (stringField(fieldsOf(inputs.args), 'id') ?? '').trim()
  const target = resolveChild(readSubagents(facts.history), id)
  if (!target) return refuse({ kind: 'refused', text: unknownIdText(id, listed(facts, inputs)) })
  const { child, latest } = target
  if (!isLive(facts, latest)) {
    const status = statusText(latest, false, false)
    return refuse({
      kind: 'not-running',
      result: {
        text: `Subagent ${child} is not running (${status}).`,
        isError: false,
        details: { sessionId: child, stopped: false }
      }
    })
  }
  const { ops, effects, ended } = stopRun(facts, latest, 'model')
  return {
    ops,
    effects,
    result: ended
      ? { kind: 'ended', result: stoppedResult(child, latest.run, { outcome: 'aborted', text: '' }) }
      : { kind: 'stopping', child, run: latest.run, key: keys.subagentMessage(child, latest.run) }
  }
}
export const stoppedResult = (child: ThreadId, run: number, answer: RunEndFacts): ToolResultFact => ({
  text: stoppedText(child, answer.text.trim() || undefined),
  isError: false,
  details: { sessionId: child, stopped: true, run }
})

/** `entries.stopSubagent` (D18, D27): the user stops a background child; false when it is not running. */
export function decideUserStopSubagent(facts: Facts, child: ThreadId): Step<boolean> {
  const ledger = readSubagents(facts.history).find((candidate) => candidate.child === child)
  if (!ledger?.latest.background || !isLive(facts, ledger.latest)) return refuse(false)
  const { ops, effects, ended } = stopRun(facts, ledger.latest, 'user')
  // Like `decideRunEnd`: the driver delivers the end of a run nobody else will record.
  return { ops: ended ? [...ops, ensureDriver(facts)] : ops, effects, result: true }
}

/** D10, §11.4: once the goal's budget is used up, its background children that are still running stop. */
export function budgetStops(facts: Facts, children: readonly ThreadId[]): Step<number> {
  const live = readSubagents(facts.history).filter(
    ({ child, latest }) => children.includes(child) && latest.background && isLive(facts, latest) && !latest.stoppedBy
  )
  // The driver that decided this delivers the ends it records here when it decides again.
  const stops = live.map(({ latest }) => stopRun(facts, latest, 'budget'))
  return { ops: stops.flatMap(({ ops }) => ops), effects: stops.flatMap(({ effects }) => effects), result: live.length }
}

/**
 * Where a `subagent-report` job's run is: a continuation names its child, a spawn's child is on its record.
 * `undefined` once the run's end is recorded (for instance by `onOpen` after a restart): the job has nothing to do.
 */
export function reportTarget(
  facts: Facts,
  input: ReportInput
): { readonly child: ThreadId; readonly run: number } | undefined {
  let child = input.child
  for (const entry of facts.history)
    if (!child && entry.kind === 'record' && entry.record.type === 'subagent-run' && entry.key === input.runKey)
      child = entry.record.value.sessionId
  if (!child) return undefined
  const ended =
    readSubagents(facts.history)
      .find((ledger) => ledger.child === child)
      ?.runs.get(input.run)?.status === 'finished'
  return ended ? undefined : { child, run: input.run }
}

/**
 * How run `run` of `child` ended (D19, Y11, Y13): the end record, written once, with `stopped` for a run someone
 * stopped; a background end wakes the driver to deliver it. The result is the foreground tool's (L4).
 */
export function decideRunEnd(
  facts: Facts,
  child: ThreadId,
  run: number,
  answer: RunEndFacts,
  report: RunReport
): Step<ToolResultFact> {
  const ledger = readSubagents(facts.history).find((candidate) => candidate.child === child)
  const record = ledger?.runs.get(run)
  if (!record) return refuse({ text: `No run ${run} of subagent ${child} is recorded.`, isError: true })
  const outcome = record.stoppedBy ? 'stopped' : answer.outcome
  const usage = facts.children.get(child)?.runUsage[run - 1]
  const ended: SubagentRunRecord = { ...record, status: 'finished', outcome, ...report, ...(usage ? { usage } : {}) }
  const key = keys.subagentEnd(child, run)
  const ops: TxOp[] = facts.keysSeen.has(key)
    ? []
    : [{ type: 'append-record', thread: facts.thread, record: { type: 'subagent-run', value: ended }, key }]
  if (ops.length > 0 && record.background && !record.modelStopped) ops.push(ensureDriver(facts))
  return {
    ops,
    effects: [],
    result: {
      text: `${runText(answer.outcome, report)}\n\n${idTrailer(child)}`,
      isError: answer.outcome !== 'completed',
      details: { sessionId: child, fork: record.fork, background: record.background, outcome }
    }
  }
}

/** D24, H11: a child's run may make at most 200 model requests, compaction included; a root conversation has no cap. */
export function allowRequest(
  requestsInRun: number,
  lineage: 'root' | 'child'
): { readonly ok: true } | { readonly ok: false; readonly text: string } {
  return lineage === 'child' && requestsInRun >= MAX_SUBAGENT_REQUESTS
    ? { ok: false, text: `The subagent reached its limit of ${MAX_SUBAGENT_REQUESTS} model requests` }
    : { ok: true }
}
