import { describe, expect, it } from 'vitest'

import type { HistoryEntry, RoundDetails } from '../../../src/core/facts'
import {
  blockedStreak,
  goalProgress,
  goalUsage,
  roundStopRequest,
  turnOrigin,
  turnStarter,
  unadmittedRoundItems
} from '../../../src/core/goal/goalHistory'
import {
  assistant,
  callTo,
  facts,
  goal,
  goalEntry,
  marker,
  PARENT,
  result,
  roundEntry,
  run,
  runEntry,
  usage,
  user
} from '../history'

const round = (n: number, id = `r${n}`): RoundDetails => ({ id, goalId: 'g1', revision: n, round: n, kind: 'work' })
const admit = (n: number, id = `r${n}`) => goalEntry(goal({ roundsStarted: n, admittedRound: id, revision: n + 1 }))
const tokens = (history: readonly HistoryEntry[], children = {}) => goalUsage(facts(history, { children }), 'g1').tokens

describe('goal usage', () => {
  // Catches a reader that decides admission when it reaches the marker: on Durable the admission follows the round's
  // first requests (R1), so the goal would miss them and overrun its budget.
  it('bills a round whose admission lands after its requests', () => {
    expect(tokens([goalEntry(goal()), roundEntry(round(1)), assistant('a', { usage: usage(7) }), admit(1)])).toBe(7)
  })

  // Catches billing a withdrawn round, which never counted, or a person's turn to the goal.
  it('bills neither an unadmitted round nor a human turn', () => {
    const history = [
      goalEntry(goal()),
      roundEntry(round(1)),
      assistant('a', { usage: usage(7) }),
      user(),
      assistant('b', { usage: usage(5) })
    ]
    expect(tokens(history)).toBe(0)
    expect(unadmittedRoundItems(facts(history))).toEqual([history[1].id])
  })

  // Catches a notification turn billed while the goal is unarmed, or not billed while it is armed (agent-runtime-pi
  // README goal §11.3).
  it('bills a notification turn only to an armed goal', () => {
    const notify = marker({ type: 'subagent-notification', runs: [], quiet: false })
    expect(tokens([goalEntry(goal()), notify, assistant('a', { usage: usage(3) })])).toBe(3)
    expect(tokens([goalEntry(goal({ armed: false })), notify, assistant('a', { usage: usage(3) })])).toBe(0)
  })

  // Catches a child run billed at delivery only (G-d), twice for its several records, or to a later human turn's goal.
  it('bills a child run as it occurs, once, to the goal whose request started it', () => {
    const history = [
      goalEntry(goal()),
      roundEntry(round(1)),
      admit(1),
      assistant('spawn', { usage: usage(1) }),
      runEntry(run('a')),
      runEntry(run('a', { stoppedBy: 'user' })),
      user(),
      assistant('continue', { usage: usage(0) }),
      runEntry(run('a', { run: 2 }))
    ]
    expect(tokens(history, { a: { running: true, runUsage: [usage(100), usage(50)] } })).toBe(101)
  })
})

describe('goal progress', () => {
  // Catches a streak that survives a person's message, or counts a round the user aborted (agent-runtime-pi README goal
  // §7.2).
  it('counts rounds without progress, reset by a person and not counting aborted rounds', () => {
    const quiet = (n: number) => [roundEntry(round(n)), admit(n), assistant('same text'), result('read')]
    const history = [goalEntry(goal()), ...quiet(1), ...quiet(2), ...quiet(3)]
    expect(goalProgress(history, 'g1')).toEqual({ progressRounds: 1, noProgressRounds: 2 })
    expect(goalProgress([...history, user()], 'g1').noProgressRounds).toBe(0)
    const aborted = [
      goalEntry(goal()),
      roundEntry(round(1)),
      admit(1),
      result('bash'),
      goalEntry(goal({ phase: 'paused', armed: false, lastStop: { code: 'aborted', at: 1 } }))
    ]
    expect(goalProgress(aborted, 'g1').progressRounds).toBe(0)
  })
})

describe('turns and round stops', () => {
  // Catches a notification that rode with a person's message taken for the turn's starter: create_goal would refuse.
  it('reads the starter of the last turn', () => {
    const notify = marker({ type: 'subagent-notification', runs: [], quiet: false })
    expect(turnStarter([user(), notify])).toBe('human')
    expect(turnStarter([assistant('x'), notify, assistant('y')])).toBe('notification')
    const history = [roundEntry(round(1)), assistant('x'), user(), assistant('y')]
    expect(turnOrigin(history, history[1].id)).toBe('goal-round')
  })

  // Catches a second notion of what starts a turn: a quiet result written while idle would turn the person's finished
  // turn into a notification turn, and goal accounting would follow it.
  it('takes a quiet notification for no turn start', () => {
    const history = [user(), assistant('x'), marker({ type: 'subagent-notification', runs: [], quiet: true })]
    expect(turnStarter(history)).toBe('human')
    expect(turnOrigin(history, history[2].id)).toBe('human')
  })

  // Catches a stop request lost to a later call, or the repeat counter not resetting on a different call (R4).
  it('asks for the latest stop the round shows', () => {
    const same = callTo('read', { path: 'a' })
    const repeated = assistant('x', { calls: [same, same, same, same, same] })
    expect(roundStopRequest([repeated], PARENT, [])).toEqual({
      code: 'no_progress',
      message: 'the same read call was repeated 5 times'
    })
    const broken = assistant('x', { calls: [same, same, callTo('ls'), same, same, same] })
    expect(roundStopRequest([broken], PARENT, [])).toBeUndefined()
    const risky = callTo('bash', {}, 'k9')
    const rounds = [
      repeated,
      result('AskUserQuestion', { details: { outcome: 'declined' } }),
      assistant('y', { calls: [risky] })
    ]
    const unavailable = [{ call: { thread: PARENT, key: risky.callKey }, state: 'unavailable' as const }]
    expect(roundStopRequest(rounds, PARENT, unavailable)).toEqual({
      code: 'awaiting_approval',
      message: 'tool call k9 needs approval and nobody can give it'
    })
    expect(roundStopRequest(rounds, PARENT, [])).toEqual({
      code: 'needs_user_input',
      message: 'the user dismissed the question'
    })
  })

  // Catches a blocked streak that survives a person's message or an edit of the goal (X15).
  it('carries the blocked streak until a reset', () => {
    const report = result('update_goal', { details: { blockedReport: { round: 2, count: 2 } } })
    expect(blockedStreak([goalEntry(goal()), report])).toEqual({ round: 2, count: 2 })
    expect(blockedStreak([goalEntry(goal()), report, user()])).toEqual({ round: 0, count: 0 })
    expect(blockedStreak([goalEntry(goal()), report, goalEntry(goal({ objective: 'other' }))])).toEqual({
      round: 0,
      count: 0
    })
  })
})
