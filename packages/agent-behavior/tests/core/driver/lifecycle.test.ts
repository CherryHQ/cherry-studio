import { describe, expect, it } from 'vitest'

import { decideAtIdle } from '../../../src/core/driver/idle'
import { decideOnOpen, decidePermissionModeChanged, decideUserStop } from '../../../src/core/driver/lifecycle'
import { currentGoal } from '../../../src/core/goal/goalHistory'
import { keys } from '../../../src/core/keys'
import { apply, assistant, facts, goal, goalEntry, inputs, marker, run, runEntry, usage, user } from '../history'

const REOPEN = { reopened: true, supportsTools: true }

describe('decideOnOpen', () => {
  // Catches a reopened armed goal starting work on its own (AC11, fixture 7): it is disarmed, its interrupted round is
  // stopped and recorded as a stop, and the next driver wake starts nothing.
  it('disarms an armed goal and stops its interrupted round', () => {
    const roundKey = keys.goalRound('g1', 1, 1, 1)
    const round = marker(
      { type: 'goal-round', round: { id: roundKey, goalId: 'g1', revision: 1, round: 1, kind: 'work' } },
      roundKey
    )
    const history = [
      goalEntry(goal()),
      round,
      goalEntry(goal({ revision: 2, roundsStarted: 1, admittedRound: roundKey })),
      assistant('x')
    ]
    const open = decideOnOpen(facts(history, { live: { idle: false } }), inputs(), REOPEN)
    expect(open.effects).toEqual([{ type: 'stop-turn', thread: 'parent', cause: 'goal-pause' }])
    expect(open.ops).toContainEqual(
      expect.objectContaining({ record: { type: 'turn-stop', value: { cause: 'reopen', at: 1000 } } })
    )
    const after = apply(history, open)
    expect(currentGoal(after)).toMatchObject({ armed: false, phase: 'active', revision: 2 })
    expect(decideAtIdle(facts(after, { live: { runEnd: { outcome: 'aborted' } } }), inputs()).result).toEqual({
      kind: 'done',
      reason: 'not-armed'
    })
  })

  // Catches a background child resuming after a restart (S-g) or its result waking the agent (agent-runtime-pi README
  // subagents).
  it('ends interrupted background runs and delivers pending results quietly', () => {
    const history = [user(), runEntry(run('a')), runEntry(run('b', { status: 'finished', outcome: 'completed' }))]
    const open = decideOnOpen(
      facts(history, { children: { a: { running: true, runUsage: [usage(1)] } } }),
      inputs(),
      REOPEN
    )
    expect(open.effects).toEqual([{ type: 'stop-child', child: 'a', run: 1 }])
    expect(open.ops).toMatchObject([
      { record: { value: { sessionId: 'a', status: 'finished', outcome: 'interrupted' } }, key: 'subagent-end:a:1' },
      { type: 'append-quiet', input: { data: { subagents: [{ sessionId: 'b' }, { sessionId: 'a' }], quiet: true } } }
    ])
    const busy = decideOnOpen(facts(history, { live: { idle: false } }), inputs(), REOPEN)
    expect(busy.ops.at(-1)).toMatchObject({ type: 'ensure-job', job: { kind: 'idle-driver' } })
  })

  // Catches a crash between the open's commit and its stops: on the next open the goal is already disarmed and the
  // records already ended, yet the restored round and child would resume unless the stops follow the live facts (H12).
  it('stops the interrupted round and children again when it reruns after its commit', () => {
    const roundKey = keys.goalRound('g1', 1, 1, 1)
    const round = marker(
      { type: 'goal-round', round: { id: roundKey, goalId: 'g1', revision: 1, round: 1, kind: 'work' } },
      roundKey
    )
    const history = [goalEntry(goal()), round, assistant('spawn'), runEntry(run('a'))]
    const live = { live: { idle: false }, children: { a: { running: true, runUsage: [usage(1)] } } }
    const first = decideOnOpen(facts(history, live), inputs(), REOPEN)
    const again = decideOnOpen(facts(apply(history, first), live), inputs(), REOPEN)
    expect(again.effects).toEqual([
      { type: 'stop-turn', thread: 'parent', cause: 'goal-pause' },
      { type: 'stop-child', child: 'a', run: 1 }
    ])
    expect(apply(apply(history, first), again)).toHaveLength(apply(history, first).length)
  })

  // Catches a foreground run left `running` forever (its `Delegation.status` stays active) after its calling tool died
  // with the restart, or one ended that a resumed tool call still awaits.
  it('ends foreground runs whose calling tool died, without stopping or delivering them', () => {
    const history = [
      user(),
      assistant('x'),
      runEntry(run('f', { background: false })),
      runEntry(run('g', { background: false }))
    ]
    const open = decideOnOpen(
      facts(history, { children: { f: { running: false, runUsage: [usage(1)] }, g: { runUsage: [] } } }),
      inputs(),
      REOPEN
    )
    expect(open).toMatchObject({
      ops: [
        { record: { value: { sessionId: 'f', status: 'finished', outcome: 'interrupted' } }, key: 'subagent-end:f:1' }
      ],
      effects: []
    })
    expect(open.ops).toHaveLength(1)
  })

  // Catches a model without tool calling leaving an active goal to drive rounds it cannot act in (X2).
  it('stops an active goal whose model cannot call tools, on any open', () => {
    const open = decideOnOpen(facts([goalEntry(goal())]), inputs(), { reopened: false, supportsTools: false })
    expect(currentGoal(apply([goalEntry(goal())], open))).toMatchObject({
      phase: 'blocked',
      lastStop: { code: 'unsupported_model' }
    })
  })
})

describe('decideUserStop (R5)', () => {
  // Catches a repeated stop request that stops whatever turn runs now: the stop must name the turn begun before its
  // record, also when it is decided again after a later turn began.
  it('names the turn begun before its record, also when decided again', () => {
    const first = user('first')
    const stop = decideUserStop(facts([first, assistant('x')]), inputs(), 'req')
    expect(stop.ops).toMatchObject([{ record: { type: 'turn-stop', value: { cause: 'user' } }, key: 'turn-stop:req' }])
    expect(stop.effects).toEqual([{ type: 'stop-turn', thread: 'parent', cause: 'user', turn: first.id }])
    const later = [...apply([first, assistant('x')], stop), user('second')]
    expect(decideUserStop(facts(later), inputs(), 'req').effects).toEqual(stop.effects)
  })

  // Catches a stop with no turn to name stopping whatever runs, which a repeated request would do to a later turn.
  it('stops nothing when no turn has begun', () => {
    expect(decideUserStop(facts([]), inputs(), 'req').effects).toEqual([])
  })
})

describe('decidePermissionModeChanged (D37)', () => {
  // Catches a driver woken on every permission switch: with nothing to do it exits at once and leaves a record each
  // time; or an armed goal plan mode held still that is never woken.
  it('wakes the driver only for an armed goal', () => {
    expect(decidePermissionModeChanged(facts([])).ops).toEqual([])
    expect(decidePermissionModeChanged(facts([goalEntry(goal({ armed: false }))])).ops).toEqual([])
    expect(decidePermissionModeChanged(facts([goalEntry(goal())])).ops).toMatchObject([{ type: 'ensure-job' }])
  })
})
