import { describe, expect, it } from 'vitest'

import type { Step } from '../../../src/core/decisions'
import { admitRound, decideAtIdle, type IdleDecision } from '../../../src/core/driver/idle'
import type { HistoryEntry, LiveFacts, RoundDetails } from '../../../src/core/facts'
import { currentGoal } from '../../../src/core/goal/goalHistory'
import { keys } from '../../../src/core/keys'
import {
  apply,
  assistant,
  callTo,
  compaction,
  facts,
  type FactsOptions,
  goal,
  goalEntry,
  inputEntry,
  inputs,
  marker,
  record,
  result,
  run,
  turnStop,
  runEntry,
  usage,
  user
} from '../history'

const idle = (history: readonly HistoryEntry[], options: FactsOptions = {}, extra = {}) =>
  decideAtIdle(facts(history, options), inputs(extra))
const ended = (live: Partial<LiveFacts> = {}) => ({ live: { runEnd: { outcome: 'completed' as const }, ...live } })
const finished = (child: string, patch = {}) =>
  runEntry(run(child, { status: 'finished', outcome: 'completed', report: `r-${child}`, ...patch }))
/** Admitted round `n` of g1 with its entries, as the driver and harness leave it. */
function round(n: number, ...entries: HistoryEntry[]): HistoryEntry[] {
  const id = keys.goalRound('g1', n, n, 1)
  const details: RoundDetails = { id, goalId: 'g1', revision: n, round: n, kind: 'work' }
  return [
    marker({ type: 'goal-round', round: details }, id),
    goalEntry(goal({ revision: n + 1, roundsStarted: n, admittedRound: id })),
    ...entries
  ]
}
/** Applies a start-turn effect as the harness would: the turn's input enters the history. */
const started = (history: readonly HistoryEntry[], step: Step<IdleDecision>): HistoryEntry[] => {
  const effect = step.effects.find((e) => e.type === 'start-turn')
  return effect?.type === 'start-turn' ? [...history, inputEntry(effect.input, effect.key)] : [...history]
}

describe('decideAtIdle: deliveries (fixtures 1–3)', () => {
  // Catches results delivered twice or lost: one notification turn, then nothing pending once its marker is in.
  it('delivers a finished background run once, and two runs that ended together in one turn', () => {
    const history = [runEntry(run('a')), finished('a'), finished('b')]
    const notify = idle(history)
    expect(notify.result).toEqual({ kind: 'notify' })
    expect(notify.effects).toMatchObject([
      {
        type: 'start-turn',
        input: {
          kind: 'cherry.subagent-notification',
          data: { subagents: [{ sessionId: 'a' }, { sessionId: 'b' }], quiet: false }
        }
      }
    ])
    expect(idle(started(history, notify)).result).toEqual({ kind: 'done', reason: 'no-goal' })
  })

  // Catches a result waking the agent after the user pressed stop (S-a), or a quiet append while a run is active.
  it('appends results quietly while a user stop suppresses waking', () => {
    const history = [user(), turnStop(), finished('a')]
    expect(idle(history).ops).toMatchObject([{ type: 'append-quiet', input: { data: { quiet: true } } }])
    expect(idle(history, { live: { idle: false } }).result).toEqual({ kind: 'wait', reason: 'busy' })
    expect(idle([finished('a', { stoppedBy: 'user', outcome: 'stopped' })]).result).toEqual({ kind: 'quiet' })
  })

  // Catches the compaction status repeating children started after the compaction, whose calls the model still sees
  // (S20 renders the status once, from what the compaction folded away).
  it('lists only children that existed before the last compaction in its status', () => {
    const step = idle([runEntry(run('a')), compaction(), assistant('spawn'), runEntry(run('b'))])
    expect(step.result).toEqual({ kind: 'status' })
    expect(step.ops).toMatchObject([{ type: 'append-quiet', input: { kind: 'cherry.subagent-status' } }])
    const text = step.ops[0].type === 'append-quiet' ? step.ops[0].input.text : ''
    expect([text.includes('task a'), text.includes('task b')]).toEqual([true, false])
    expect(idle([compaction(), assistant('spawn'), runEntry(run('b'))]).result).toEqual({
      kind: 'done',
      reason: 'no-goal'
    })
  })

  // Catches a goal round starting ahead of a waiting result (X23: the notification turn goes first).
  it('notifies before the next goal round', () => {
    expect(idle([goalEntry(goal()), finished('a')]).result).toEqual({ kind: 'notify' })
  })
})

describe('decideAtIdle: the goal (fixtures 4–6, 8)', () => {
  // Catches a hint after the wrong streak, or a third round without progress that does not stop the goal.
  it('hints after two rounds without progress and stops after three', () => {
    const quiet = (n: number) => round(n, assistant('same'), result('read'))
    expect(idle([goalEntry(goal()), ...quiet(1), ...quiet(2), ...quiet(3)], ended()).result).toMatchObject({
      kind: 'start-round',
      round: { kind: 'hint' }
    })
    const four = [goalEntry(goal()), ...quiet(1), ...quiet(2), ...quiet(3), ...quiet(4)]
    expect(idle(four, ended()).result).toEqual({ kind: 'stop-goal', code: 'no_progress' })
  })

  // Catches a gate that blocks repeats but never stops the goal (R4), and a denial that stops it from a human turn or
  // from another conversation's call with the same key (D9).
  it('stops after the fifth identical call and on a denial in a goal round only', () => {
    const same = callTo('read', { p: 1 })
    const repeats = [goalEntry(goal()), ...round(1, assistant('x', { calls: [same, same, same, same, same] }))]
    expect(idle(repeats, ended()).result).toEqual({ kind: 'stop-goal', code: 'no_progress' })
    const risky = callTo('bash', {}, 'k9')
    const denied = (thread: string) => ({
      approvals: [{ call: { thread: thread as never, key: risky.callKey }, state: 'denied' as const }]
    })
    const inRound = [
      goalEntry(goal()),
      ...round(1, assistant('x', { calls: [risky] }), result('bash', { callId: 'k9' }))
    ]
    expect(idle(inRound, ended(), denied('parent'))).toMatchObject({
      result: { kind: 'stop-goal', code: 'approval_denied' },
      ops: [{ record: { value: { lastStop: { message: 'tool call k9 was denied' } } } }]
    })
    expect(idle(inRound, ended(), denied('child')).result).toMatchObject({ kind: 'start-round' })
    const human = [goalEntry(goal()), user(), assistant('x', { calls: [risky] })]
    expect(idle(human, ended(), denied('parent')).result).toMatchObject({ kind: 'start-round' })
  })

  // Catches a resumed goal reusing the round key of the round the reopen withdrew (armSeq, fixture 8).
  it('derives a new round key after a disarm and resume', () => {
    const before = idle([goalEntry(goal())]).result
    const resumed = idle([goalEntry(goal()), goalEntry(goal({ armed: false })), goalEntry(goal())]).result
    expect(before).toMatchObject({ kind: 'start-round', key: keys.goalRound('g1', 1, 1, 1) })
    expect(resumed).toMatchObject({ kind: 'start-round', key: keys.goalRound('g1', 1, 1, 2) })
  })

  // Catches our own withdrawal taken for the user's stop, or the user's stop ignored (README goal §6.3).
  it('stops on a user abort but goes on after its own withdrawal', () => {
    const aborted = { live: { runEnd: { outcome: 'aborted' as const } } }
    const history = [goalEntry(goal()), ...round(1, assistant('x'))]
    expect(idle(history, aborted).result).toMatchObject({ kind: 'start-round' })
    const stopped = [...history, turnStop()]
    expect(idle(stopped, aborted).result).toEqual({ kind: 'stop-goal', code: 'aborted' })
    const error = { live: { runEnd: { outcome: 'error' as const } } }
    expect(idle([goalEntry(goal()), ...round(1, assistant('', { error: 'quota' }))], error).ops).toMatchObject([
      { record: { value: { lastStop: { code: 'provider_error', message: 'quota' } } } }
    ])
  })

  // Catches a run end judged again after the person resumed: the resumed goal would stop at once.
  it('does not judge a run that ended before the goal was armed again', () => {
    const history = [
      goalEntry(goal()),
      ...round(1, assistant('x')),
      turnStop(),
      goalEntry(goal({ revision: 3, armed: false, phase: 'paused' })),
      goalEntry(goal({ revision: 4, roundsStarted: 1 }))
    ]
    expect(idle(history, { live: { runEnd: { outcome: 'aborted' } } }).result).toMatchObject({ kind: 'start-round' })
  })

  // Catches confirm-each-round running a second round, or pausing again right after the person's resume.
  it('pauses after each round in confirm-each-round mode', () => {
    const settings = { settings: { ...inputs().settings, autonomy: 'confirm-each-round' as const } }
    const history = [goalEntry(goal()), ...round(1, assistant('x'))]
    expect(idle(history, ended(), settings).result).toEqual({ kind: 'stop-goal', code: 'paused_each_round' })
    expect(
      idle(
        [
          ...history,
          goalEntry(goal({ armed: false, revision: 3 })),
          goalEntry(goal({ revision: 3, roundsStarted: 1 }))
        ],
        ended(),
        settings
      ).result
    ).toMatchObject({ kind: 'start-round' })
  })
})

describe('decideAtIdle: order and exit', () => {
  // Catches a round started over a person's queued message, or the driver spinning on a failed run's leftovers.
  it('waits for queued user input only while a run is active', () => {
    expect(idle([goalEntry(goal())], { live: { idle: false, queuedUserInput: true } }).result).toEqual({
      kind: 'wait',
      reason: 'user-first'
    })
    expect(
      idle([goalEntry(goal())], { live: { idle: false, leftoverInputs: 1, queuedUserInput: true } }).result
    ).toMatchObject({ kind: 'start-round' })
  })

  // Catches a used-up budget leaving the goal's background children running (README goal §11.4).
  it('stops the goal background children first once its budget is used up', () => {
    const budget = goalEntry(goal({ revision: 3, roundsStarted: 1, budget: { tokens: 10 } }))
    const spent = [goalEntry(goal()), ...round(1, assistant('spawn', { usage: usage(4) }), runEntry(run('a'))), budget]
    const step = idle(spent, { children: { a: { running: true, runUsage: [usage(20)] } } })
    expect(step.result).toEqual({ kind: 'stop-children', count: 1 })
    expect(step.effects).toEqual([{ type: 'stop-child', child: 'a', run: 1 }])
  })

  // Catches a driver that exits without its keyed exit record: an ensure racing the exit would be swallowed (H4).
  it('exits with the exit record of its generation when nothing is left', () => {
    const history = [record({ type: 'idle-driver-exit', value: { generation: 0 } })]
    expect(idle(history, {}, { settings: { ...inputs().settings, permissionMode: 'plan' as const } }).ops).toEqual([
      {
        type: 'append-record',
        thread: 'parent',
        record: { type: 'idle-driver-exit', value: { generation: 1 } },
        key: keys.idleDriverExit('parent' as never, 1)
      }
    ])
    expect(
      idle([goalEntry(goal())], {}, { settings: { ...inputs().settings, permissionMode: 'plan' as const } }).result
    ).toEqual({ kind: 'done', reason: 'plan-mode' })
  })
})

describe('admitRound (R1)', () => {
  // Catches a round counted although a command changed the goal after the driver reserved it, or counted twice.
  it('admits the reserved round once and withdraws it when the goal changed', () => {
    const history = [goalEntry(goal())]
    const start = idle(history).result
    if (start.kind !== 'start-round') throw new Error('expected a round')
    const admitted = admitRound(facts(started(history, idle(history))), inputs(), start)
    const after = apply(started(history, idle(history)), admitted)
    expect(currentGoal(after)).toMatchObject({ roundsStarted: 1, admittedRound: start.key, revision: 2 })
    expect(admitRound(facts(after), inputs(), start).ops).toEqual([])
    const edited = [...history, goalEntry(goal({ revision: 2, objective: 'new' }))]
    expect(admitRound(facts(edited), inputs(), start)).toMatchObject({
      result: 'withdraw',
      effects: [{ type: 'retract-turn', key: start.key }]
    })
  })
})
