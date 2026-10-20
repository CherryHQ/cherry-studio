import { describe, expect, it } from 'vitest'

import type { ItemId, ThreadId } from '@cherrystudio/agent-runtime'

import { callKeyOf, type GoalSnapshot, type HistoryEntry } from '../../src/core/facts'
import { armSeq, idleDriverGeneration, keys, nextRun, withdrawGeneration } from '../../src/core/keys'
import { deepFreeze, withoutEnvironment } from './purity'

const thread = (value: string) => value as ThreadId
const call = callKeyOf('task-7')
let ids = 0
const goalRecord = (id: string, revision: number, armed: boolean): HistoryEntry => {
  const value: GoalSnapshot = {
    id,
    revision,
    armed,
    objective: 'o',
    phase: 'active',
    roundsStarted: 0,
    progressRounds: 0,
    maxGoalRounds: 20,
    tokensUsed: 0,
    costUsed: 0,
    wrapUpDone: false,
    createdAt: 0,
    updatedAt: 0
  }
  return { kind: 'record', id: `item-${++ids}` as ItemId, record: { type: 'goal', value } }
}
const runRecord = (child: string, run: number): HistoryEntry => ({
  kind: 'record',
  id: `item-${++ids}` as ItemId,
  record: {
    type: 'subagent-run',
    value: {
      sessionId: thread(child),
      parentToolCallId: 'c',
      description: 'd',
      fork: false,
      background: true,
      modelKey: 'p/m',
      run,
      status: 'running'
    }
  }
})

describe('keys', () => {
  // Catches a format change: keys are stored as data.key and used as Durable request ids, so a restarted harness
  // would stop recognising work it already did (design §7.3).
  it('derives the design §7.3 formats', () => {
    expect(keys.goalFromCall(call)).toBe('goal:call:task-7')
    expect(keys.goalFromCommand('msg-1')).toBe('goal:cmd:msg-1')
    expect(keys.goalRound('goal:call:task-7', 3, 2, 1)).toBe('goal-round:goal:call:task-7:r3:v2:a1')
    expect(keys.goalAdmit(keys.goalRound('goal:call:task-7', 3, 2, 1))).toBe(
      'goal-admit:goal-round:goal:call:task-7:r3:v2:a1'
    )
    expect(keys.subagentSpawn(call)).toBe('subagent-spawn:task-7')
    expect(keys.subagentMessage(thread('child-1'), 2)).toBe('subagent-msg:child-1:2')
    expect(keys.subagentEnd(thread('child-1'), 2)).toBe('subagent-end:child-1:2')
    expect(keys.turnStop('req-9')).toBe('turn-stop:req-9')
    expect(keys.idleDriver(thread('p'), 0)).toBe('idle-driver:p:g0')
    expect(keys.idleDriverExit(thread('p'), 0)).toBe('idle-driver-exit:p:g0')
    expect(keys.subagentReport(keys.subagentSpawn(call))).toBe('subagent-report:subagent-spawn:task-7')
    expect(keys.approvalMemo(call)).toBe('cherry.approval:task-7')
    expect(keys.askMemo(call)).toBe('cherry.ask:task-7')
    expect(keys.verdictMemo(call)).toBe('cherry.verdict:task-7')
    expect(keys.summaryMemo('compaction-4')).toBe('cherry.summary:compaction-4')
  })

  // Review focus 3: one batch delivered in a different order must not get a second key, and different batches or
  // parents must not share one.
  it('keys a notification batch by its content, not its order', () => {
    const a = { child: thread('c1'), run: 1 }
    const b = { child: thread('c2'), run: 3 }
    const key = withoutEnvironment(() => keys.subagentNotify(thread('p'), deepFreeze([a, b]), 0))
    expect(keys.subagentNotify(thread('p'), [b, a], 0)).toBe(key)
    expect(keys.subagentNotify(thread('p'), [a], 0)).not.toBe(key)
    expect(keys.subagentNotify(thread('q'), [a, b], 0)).not.toBe(key)
    expect(key).toMatch(/^subagent-notify:p:s0:[0-9a-f]{64}$/)
  })

  // Catches a notification key a stop leaves unchanged (I1): Turns answers the withdrawn key with its first admission
  // and never takes the input again, so the driver would offer the same batch forever.
  it('gives a batch a new key after each turn-stop record', () => {
    const stop = (): HistoryEntry => ({
      kind: 'record',
      id: `item-${++ids}` as ItemId,
      record: { type: 'turn-stop', value: { cause: 'user', at: 0 } }
    })
    const history = deepFreeze([runRecord('c1', 1), stop(), goalRecord('g', 1, true), stop()])
    expect(withoutEnvironment(() => withdrawGeneration(history))).toBe(2)
    expect(withdrawGeneration(history.slice(0, 2))).toBe(1)
    const batch = [{ child: thread('c1'), run: 1 }]
    expect(keys.subagentNotify(thread('p'), batch, 1)).not.toBe(keys.subagentNotify(thread('p'), batch, 0))
  })

  // Catches a batch key that joins `child:run` pairs (two runs vs one run of child `a:1:b`), or one goal id for a call key and an equal request key.
  it('stays injective when ids contain the separator', () => {
    expect(
      keys.subagentNotify(
        thread('p'),
        [
          { child: thread('a'), run: 1 },
          { child: thread('b'), run: 2 }
        ],
        0
      )
    ).not.toBe(keys.subagentNotify(thread('p'), [{ child: thread('a:1:b'), run: 2 }], 0))
    expect(keys.goalFromCall(callKeyOf('req-1'))).not.toBe(keys.goalFromCommand('req-1'))
  })

  // Catches design §7.3's bug: a goal disarmed on reopen and resumed keeps its revision, so without a new armSeq the
  // resumed round reuses the withdrawn round's key and is deduplicated away.
  it('counts arming transitions, not revisions', () => {
    const history = deepFreeze([
      goalRecord('g', 1, true),
      goalRecord('g', 2, true),
      goalRecord('g', 2, false),
      goalRecord('g', 2, true),
      goalRecord('other', 1, true)
    ])
    expect(withoutEnvironment(() => armSeq(history, 'g'))).toBe(2)
    expect(armSeq(history.slice(0, 3), 'g')).toBe(1)
    expect(armSeq(history, 'missing')).toBe(0)
    expect(keys.goalRound('g', 3, 2, armSeq(history.slice(0, 3), 'g'))).not.toBe(
      keys.goalRound('g', 3, 2, armSeq(history, 'g'))
    )
  })

  // Catches a driver key unchanged by the driver's exit, so an ensure after the exit is dropped as the exiting driver's and its wakeup is lost (H4).
  it('moves the idle driver to the next generation with each exit record', () => {
    const exit = (generation: number): HistoryEntry => ({
      kind: 'record',
      id: `item-${++ids}` as ItemId,
      record: { type: 'idle-driver-exit', value: { generation } }
    })
    const history = deepFreeze([goalRecord('g', 1, true), exit(0), runRecord('c1', 1), exit(1)])
    expect(withoutEnvironment(() => idleDriverGeneration([]))).toBe(0)
    expect(idleDriverGeneration(history.slice(0, 2))).toBe(1)
    expect(idleDriverGeneration(history)).toBe(2)
  })

  // Catches a continuation reusing run n's message key, which Durable answers with the old submission instead of run n+1.
  it('numbers the next run after the latest run record of that child', () => {
    const history = deepFreeze([runRecord('c1', 1), runRecord('c2', 4), runRecord('c1', 2)])
    expect(withoutEnvironment(() => nextRun(history, thread('c1')))).toBe(3)
    expect(nextRun(history, thread('c3'))).toBe(1)
  })

  // Catches two Stage B writers sharing a key, so `keysSeen` would drop the second write as a duplicate (design §7.2),
  // or a format change that strands records written before it.
  it('derives distinct keys for every Stage B write', () => {
    const child = thread('c:1')
    const item = 'item-1' as ItemId
    const all = [
      keys.goalFromCall(call),
      keys.goalCall(call),
      keys.goalCommand('task-7'),
      keys.goalNotice('task-7'),
      keys.turnStop('task-7'),
      keys.goalStop('g', 1, 1),
      keys.goalDisarm('g', 1),
      keys.goalCounts('g', 1, 1),
      keys.subagentSteer(call, 1),
      keys.subagentSteer(call, 2),
      keys.subagentSteerWithdrawn(call, 1),
      keys.subagentContinue(call),
      keys.subagentStop(child, 1, 'model'),
      keys.subagentStop(child, 1, 'user'),
      keys.subagentStatus(item),
      keys.reopenStop(item)
    ]
    expect(new Set(all).size).toBe(all.length)
    expect(keys.goalStop('goal:call:k', 2, 3)).toBe('goal-stop:goal:call:k:v2:a3')
    expect(keys.subagentStop(child, 2, 'budget')).toBe('subagent-stop:c:1:2:budget')
  })

  // Catches a steer key without its run (G-C5): a decision again after a withdrawn steer that lands on a later run would
  // reuse the withdrawn key, which the harness keeps answering 'withdrawn', so message_subagent would retry forever.
  it('keys a steer by its call and the run it joins', () => {
    const steer = withoutEnvironment(() => keys.subagentSteer(callKeyOf('c:1'), 2))
    expect(steer).toBe('subagent-steer:c:1:2')
    expect(keys.subagentSteer(callKeyOf('c:1'), 2)).toBe(steer)
    expect(keys.subagentSteer(callKeyOf('c:1'), 3)).not.toBe(steer)
    expect(keys.subagentSteer(callKeyOf('c'), 12)).not.toBe(steer)
  })
})
