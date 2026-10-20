import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { answerVerdict, decideApproval, repeatBlock } from '../../src/core/approval/approval'
import { offloadPlan } from '../../src/core/context/offload'
import { recallText } from '../../src/core/context/recall'
import { admitRound, decideAtIdle } from '../../src/core/driver/idle'
import { decideOnOpen, decidePermissionModeChanged, decideUserStop } from '../../src/core/driver/lifecycle'
import { decodeEntry, encodeEntry } from '../../src/core/entryCodec'
import { type ConversationFacts, ENTRY_KINDS, type EntryKind, type HistoryEntry } from '../../src/core/facts'
import { decideGoalCommand } from '../../src/core/goal/goalCommand'
import { goalUsage, turnOrigin, unadmittedRoundItems } from '../../src/core/goal/goalHistory'
import { decideCreateGoal, decideUpdateGoal } from '../../src/core/goal/goalTools'
import { decideAskUser } from '../../src/core/interaction/askUser'
import { decideTodos } from '../../src/core/interaction/todo'
import { keys } from '../../src/core/keys'
import {
  budgetStops,
  decideMessage,
  decideRunEnd,
  decideSpawn,
  decideStop,
  decideUserStopSubagent,
  reportTarget
} from '../../src/core/subagents/subagentDecisions'
import { interruptRoute, runStopping, subagentViews } from '../../src/core/subagents/subagentLedger'
import {
  apply,
  assistant,
  call,
  callTo,
  facts,
  goal,
  goalEntry,
  inputEntry,
  inputs,
  result,
  run,
  runEntry,
  thread,
  turnStop,
  usage,
  user
} from './history'
import { deepFreeze, withoutEnvironment } from './purity'

/** Seeded so a failing case reproduces; no dependency. */
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Expected = { readonly tokens: number; readonly rounds: number }
/**
 * Drives the core the way the idle driver and a harness would: create, then rounds with random usage, and background
 * children that run to their end and are delivered by a notification turn. Alongside it keeps what each goal record
 * should say, counted by hand: the requests of admitted rounds and of notification turns (the goal stays armed), and 7
 * tokens per child those rounds started, as the history stood when the record was written.
 */
function drive(seed: number): { readonly history: HistoryEntry[]; readonly expected: Expected[] } {
  const next = random(seed)
  const at = (history: readonly HistoryEntry[]) =>
    facts(history, { children: children(history), live: { runEnd: { outcome: 'completed' } } })
  let history = apply(
    [user()],
    decideCreateGoal(facts([user()]), inputs({ args: { objective: 'o', max_goal_rounds: 6 } }), call('k'))
  )
  const expected: Expected[] = [{ tokens: 0, rounds: 0 }]
  let billed = 0
  let rounds = 0
  for (let i = 0; i < 16; i++) {
    const step = decideAtIdle(at(history), inputs())
    if (step.result.kind !== 'start-round' && step.result.kind !== 'notify') break
    const effect = step.effects[0]
    if (effect.type !== 'start-turn') throw new Error('a round or a notification starts a turn')
    history = [...history, inputEntry(effect.input, effect.key)]
    const tokens = Math.floor(next() * 100)
    const request = assistant(next() < 0.5 ? 'same' : `text ${i}`, { usage: usage(tokens) })
    if (step.result.kind === 'notify') {
      history = [...history, request]
      billed += tokens
      continue
    }
    // Half the time the admission lands after the round's first request, as on Durable (R1).
    const first = next() < 0.5
    if (first) {
      history = [...history, request]
      billed += tokens
    }
    history = apply(history, admitRound(at(history), inputs(), step.result))
    expected.push({ tokens: billed, rounds: ++rounds })
    if (!first) {
      history = [...history, request]
      billed += tokens
    }
    const child = next() < 0.3 ? `c${i}` : undefined
    if (child) {
      history = [...history, runEntry(run(child))]
      billed += 7
    }
    history = [...history, result(next() < 0.5 ? 'read' : 'bash')]
    // The child ends after the round; its result waits for the next wake.
    if (child)
      history = [
        ...history,
        runEntry(run(child, { status: 'finished', outcome: 'completed', report: 'done', usage: usage(7) }))
      ]
  }
  return { history, expected }
}
const children = (history: readonly HistoryEntry[]) =>
  Object.fromEntries(
    history.flatMap((entry) =>
      entry.kind === 'record' && entry.record.type === 'subagent-run'
        ? [[entry.record.value.sessionId, { running: true, runUsage: [usage(7)] }]]
        : []
    )
  )

describe('replay invariants', () => {
  // I1. Catches a counter kept apart from the history drifting from it: every goal record carries the usage and the
  // round number counted by hand while the history was built.
  it('I1: goal records carry the counts accumulated so far', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { history, expected } = drive(seed)
      const written = history.flatMap((entry) =>
        entry.kind === 'record' && entry.record.type === 'goal' && !('cleared' in entry.record.value)
          ? [{ tokens: entry.record.value.tokensUsed, rounds: entry.record.value.roundsStarted }]
          : []
      )
      expect(written).toEqual(expected)
    }
  })

  // I2 as the core can check it. Catches a rule that reads a field the stored form drops or rewrites (a stop's `cause`,
  // a run's `report`, a snapshot's `admittedRound`): the history as an adapter stores and reads it back gives the same
  // decision, with clock and randomness unavailable, on each path the seeds reach.
  it('decides the same after the storage round trip, with clock and randomness unavailable', () => {
    const stored = (entry: HistoryEntry): HistoryEntry => {
      const wire = (value: unknown) => JSON.parse(JSON.stringify(value))
      if (entry.kind !== 'record' && entry.kind !== 'marker') return wire(entry)
      const { kind, data } = encodeEntry(entry.kind === 'record' ? entry.record : entry.marker, entry.key)
      const text = entry.kind === 'marker' ? entry.text : undefined
      const decoded = decodeEntry({ id: entry.id, kind, data: wire(data), ...(text === undefined ? {} : { text }) })
      if (!decoded) throw new Error(`${kind} did not decode`)
      return decoded
    }
    const decided = new Set<string>()
    for (let seed = 1; seed <= 25; seed++) {
      // By seed: nothing pending (the goal decides), a result a `/goal` command's stop holds back, or one to deliver.
      const history = [
        ...drive(seed).history,
        ...(seed % 3 === 0 ? [] : [runEntry(run('z', { status: 'finished', outcome: 'completed', report: 'done' }))]),
        ...(seed % 3 === 1 ? [turnStop('goal-command')] : [])
      ]
      // After an aborted run only a person's stop ends the goal, so the stop's `cause` decides.
      const options = {
        children: { c1: { running: true, runUsage: [usage(3)] } },
        live: { runEnd: { outcome: 'aborted' as const } }
      }
      const before = withoutEnvironment(() => decideAtIdle(facts(history, options), inputs()))
      const after = withoutEnvironment(() => decideAtIdle(facts(history.map(stored), options), inputs()))
      expect(after).toEqual(before)
      decided.add(before.result.kind)
    }
    expect([...decided].sort()).toEqual(['notify', 'quiet', 'stop-goal'])
  })

  // Not I3 itself: there is no incremental cache to compare until G-a (PR-3b), and readers fold the whole history.
  // Catches a fold that judges admission by position: moving an admission later within its round changes nothing.
  it('bills a round the same wherever its admission lands within it', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { history } = drive(seed)
      const usageOf = (h: readonly HistoryEntry[]) => goalUsage(facts(h, { children: children(h) }), 'goal:call:k')
      const at = history.findIndex(
        (entry) => entry.kind === 'record' && entry.record.type === 'goal' && 'admittedRound' in entry.record.value
      )
      if (at < 0) continue
      const moved = [...history.slice(0, at), ...history.slice(at + 1, at + 2), history[at], ...history.slice(at + 2)]
      expect(usageOf(moved)).toEqual(usageOf(history))
    }
  })

  // Budget property. Catches a person's turn billed to the goal, or a child run billed once per record.
  it('bills neither appended human turns nor repeated records of a run', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { history } = drive(seed)
      const usageOf = (h: readonly HistoryEntry[]) => goalUsage(facts(h, { children: children(h) }), 'goal:call:k')
      const base = usageOf(history)
      expect(usageOf([...history, user(), assistant('x', { usage: usage(1000) })])).toEqual(base)
      const runs = history.filter((entry) => entry.kind === 'record' && entry.record.type === 'subagent-run')
      expect(usageOf([...history, ...runs])).toEqual(base)
    }
  })
})

const ID_FIELDS = new Set(['thread', 'child', 'scope', 'sessionId', 'from', 'at', 'goalId'])
const KEY_PREFIX = /^(?:goal|subagent|turn-stop|reopen-stop|idle-driver|cherry\.)/
function strings(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'string') into.add(value)
  else if (value instanceof Map || value instanceof Set) for (const item of value) strings(item, into)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) strings(item, into)
  return into
}
function untraced(output: unknown, known: Set<string>, found: string[] = []): string[] {
  if (Array.isArray(output)) for (const item of output) untraced(item, known, found)
  else if (output && typeof output === 'object')
    for (const [field, value] of Object.entries(output)) {
      if (typeof value === 'string' && ID_FIELDS.has(field) && !known.has(value)) found.push(`${field}=${value}`)
      if (typeof value === 'string' && field === 'key' && !KEY_PREFIX.test(value)) found.push(`key=${value}`)
      untraced(value, known, found)
    }
  return found
}

/** Makes the Maps and Sets inside `value` refuse writes; `deepFreeze` freezes only the objects that hold them. */
function lockCollections<T>(value: T): T {
  const refuse = () => {
    throw new Error('a rule mutated its input')
  }
  if (value instanceof Map || value instanceof Set) {
    for (const name of ['set', 'add', 'delete', 'clear']) Object.defineProperty(value, name, { value: refuse })
    for (const item of value instanceof Map ? value.values() : value) lockCollections(item)
  } else if (value && typeof value === 'object') for (const item of Object.values(value)) lockCollections(item)
  return value
}

describe('purity (AC7)', () => {
  const live = { children: { a: { running: true, runUsage: [usage(1)] } } }
  const asked = [user(), assistant('x')]
  const host = {
    category: 'other' as const,
    disabled: false,
    autoApproved: false,
    approvalRequired: false,
    nonBypassable: false,
    withinAllowedRoots: true,
    destructive: false
  }
  const question = {
    questions: [
      {
        question: 'Q?',
        header: 'h',
        options: [
          { label: 'a', description: 'a' },
          { label: 'b', description: 'b' }
        ]
      }
    ]
  }
  const cases: [string, unknown, () => unknown][] = []
  const add = <T>(name: string, input: T, decide: (input: T) => unknown) =>
    cases.push([name, input, () => decide(input)])
  add(
    'decideSpawn',
    { f: facts(asked), i: inputs({ args: { description: 'd', prompt: 'p', background: true, fork: true } }) },
    ({ f, i }) => decideSpawn(f, i, call('k'))
  )
  add(
    'decideMessage',
    {
      f: facts([runEntry(run('a', { status: 'finished', outcome: 'completed' }))]),
      i: inputs({ args: { id: 'a', message: 'm' } })
    },
    ({ f, i }) => decideMessage(f, i, call('k'))
  )
  add('decideStop', { f: facts([runEntry(run('a'))], live), i: inputs({ args: { id: 'a' } }) }, ({ f, i }) =>
    decideStop(f, i)
  )
  add('decideRunEnd', facts([runEntry(run('a'))], live), (f) =>
    decideRunEnd(f, 'a' as never, 1, { outcome: 'completed', text: 'r' }, { report: 'r' })
  )
  add('decideCreateGoal', { f: facts([user()]), i: inputs({ args: { objective: 'o' } }) }, ({ f, i }) =>
    decideCreateGoal(f, i, call('k'))
  )
  add(
    'decideUpdateGoal',
    { f: facts([user(), goalEntry(goal())]), i: inputs({ args: { goal_id: 'g1', revision: 1, action: 'pause' } }) },
    ({ f, i }) => decideUpdateGoal(f, i, call('k'))
  )
  add('decideGoalCommand', facts([goalEntry(goal())], { live: { idle: false } }), (f) =>
    decideGoalCommand(f, inputs(), 'clear', 'r1')
  )
  const driven = facts(drive(3).history)
  add('decideAtIdle', driven, (f) => decideAtIdle(f, inputs()))
  const fresh = facts([goalEntry(goal())])
  const started = decideAtIdle(fresh, inputs()).result
  if (started.kind !== 'start-round') throw new Error('an armed goal with no rounds starts one')
  add('admitRound', fresh, (f) => admitRound(f, inputs(), started))
  add('decideUserStop', facts([user()]), (f) => decideUserStop(f, inputs(), 'r1'))
  add('decideUserStopSubagent', facts([runEntry(run('a'))], live), (f: ConversationFacts) =>
    decideUserStopSubagent(f, 'a' as never)
  )
  add('budgetStops', facts([runEntry(run('a'))], live), (f: ConversationFacts) => budgetStops(f, ['a' as never]))
  add('subagentViews', facts([runEntry(run('a'))], live), (f) => subagentViews(f, []))
  add('turnOrigin', drive(6).history, (h) => turnOrigin(h, h[h.length - 1].id))
  add('decideOnOpen', facts([goalEntry(goal()), runEntry(run('a'))], live), (f) =>
    decideOnOpen(f, inputs(), { reopened: true, supportsTools: true })
  )
  add('decidePermissionModeChanged', facts([goalEntry(goal())]), (f) => decidePermissionModeChanged(f))
  add(
    'reportTarget',
    {
      f: facts([runEntry(run('a'))], live),
      i: { runKey: keys.subagentSpawn(call('k')), run: 1, text: 't', child: thread('a') }
    },
    ({ f, i }) => reportTarget(f, i)
  )
  add('runStopping', [runEntry(run('a', { stoppedBy: 'model' }))], (h) => runStopping(h, 'a' as never, 1))
  add('interruptRoute', facts([runEntry(run('a'))], live), (f: ConversationFacts) => interruptRoute(f, 'a' as never))
  add('unadmittedRoundItems', facts(drive(5).history, { live: { idle: false } }), (f) => unadmittedRoundItems(f))
  const repeated = callTo('read', { path: 'x' })
  add('repeatBlock', { goalRound: true, plan: undefined, callWindow: [repeated, repeated, repeated] }, (f) =>
    repeatBlock(
      { key: repeated.callKey, thread: 'parent' as never, tool: 'read', args: { path: 'x' }, nested: false },
      f
    )
  )
  add('answerVerdict', { kind: 'granted' as const, args: { path: 'y' } }, (a) => answerVerdict(a, { path: 'x' }))
  add('decideApproval', host, (h) =>
    decideApproval(
      { key: call('k'), thread: 'parent' as never, tool: 'x', args: {}, nested: false },
      h,
      'default',
      'stream',
      undefined
    )
  )
  add('decideAskUser', question, (q) => decideAskUser({ kind: 'root' }, q))
  add('decideTodos', { todos: [{ content: 'a', status: 'pending' }] }, (t) => decideTodos(t))
  add('recallText', drive(4).history, (h) => recallText(h, { query: 'text' }))
  add('offloadPlan', { text: 'x'.repeat(5000), isError: false }, (r) =>
    offloadPlan({ tool: 'bash', nested: false }, r, 10)
  )
  // Catches a rule that reads the clock or randomness, mutates its input, returns something memo cannot store, or
  // invents an id: each would make a rerun after a crash decide differently (design §11.10).
  it.each(cases)(
    '%s is deterministic, leaves its input alone, survives JSON and invents no ids',
    (_name, input, decide) => {
      deepFreeze(lockCollections(input))
      const first = withoutEnvironment(decide)
      expect(withoutEnvironment(decide)).toEqual(first)
      expect(JSON.parse(JSON.stringify(first))).toEqual(first)
      expect(untraced(first, strings(input))).toEqual([])
    }
  )
})

describe('entry kinds', () => {
  /** The code that writes or reads each kind in a rule; origins are written through `ChildSpec.origin`. */
  const USED_AS: { readonly [kind in EntryKind]: string } = {
    'cherry.goal': "record.type === 'goal'",
    'cherry.goal-round': "marker.type === 'goal-round'",
    'cherry.goal-notice': "type: 'goal-notice', value",
    'cherry.subagent-state': "record.type === 'subagent-run'",
    'cherry.subagent-origin': 'SubagentOrigin',
    'cherry.subagent-notification': "marker.type === 'subagent-notification'",
    'cherry.subagent-status': "{ type: 'subagent-status' }",
    'cherry.subagent-message': "{ type: 'subagent-message' }",
    'cherry.plan': "record.type === 'plan'",
    'cherry.turn-stop': "record.type === 'turn-stop'",
    'cherry.idle-driver-exit': "type: 'idle-driver-exit', value"
  }
  // Catches a kind added to ENTRY_KINDS that no rule writes or reads: adapters would store it for nothing. The map
  // fails to compile until a new kind is listed.
  it('every custom kind is written or read by a rule', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../src/core')
    const rules = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((file) => /[\\/]/.test(file) && file.endsWith('.ts'))
      .map((file) => readFileSync(join(root, file), 'utf8'))
      .join('\n')
    expect(Object.values(ENTRY_KINDS).filter((kind) => !rules.includes(USED_AS[kind]))).toEqual([])
  })
})
