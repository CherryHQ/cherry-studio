import { describe, expect, it } from 'vitest'

import type { ItemId, ThreadId } from '@cherrystudio/agent-runtime'

import { callKeyOf, type GoalSnapshot, type HistoryEntry } from '../../src/core/facts'
import { armSeq, keys, nextRun } from '../../src/core/keys'
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
    expect(keys.goalFromCall(call)).toBe('goal:task-7')
    expect(keys.goalFromCommand('msg-1')).toBe('goal:msg-1')
    expect(keys.goalRound('goal:task-7', 3, 2, 1)).toBe('goal-round:goal:task-7:r3:v2:a1')
    expect(keys.goalAdmit(keys.goalRound('goal:task-7', 3, 2, 1))).toBe('goal-admit:goal-round:goal:task-7:r3:v2:a1')
    expect(keys.subagentSpawn(call)).toBe('subagent-spawn:task-7')
    expect(keys.subagentMessage(thread('child-1'), 2)).toBe('subagent-msg:child-1:2')
    expect(keys.subagentEnd(thread('child-1'), 2)).toBe('subagent-end:child-1:2')
    expect(keys.turnStop('req-9')).toBe('turn-stop:req-9')
    expect(keys.idleDriver(thread('p'))).toBe('idle-driver:p')
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
    const key = withoutEnvironment(() => keys.subagentNotify(thread('p'), deepFreeze([a, b])))
    expect(keys.subagentNotify(thread('p'), [b, a])).toBe(key)
    expect(keys.subagentNotify(thread('p'), [a])).not.toBe(key)
    expect(keys.subagentNotify(thread('q'), [a, b])).not.toBe(key)
    expect(key).toMatch(/^subagent-notify:p:[0-9a-f]{64}$/)
  })

  // Review focus 3: ids containing ':' must not make two different inputs share a key.
  it('stays injective when ids contain the separator', () => {
    expect(keys.subagentNotify(thread('p'), [{ child: thread('a:1'), run: 2 }])).not.toBe(
      keys.subagentNotify(thread('p'), [{ child: thread('a'), run: 12 }])
    )
    expect(keys.subagentMessage(thread('a:1'), 2)).not.toBe(keys.subagentMessage(thread('a'), 12))
    expect(keys.goalRound('g:r1', 2, 3, 4)).not.toBe(keys.goalRound('g', 1, 2, 3))
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

  // Catches a continuation reusing run n's message key, which Durable answers with the old submission instead of run n+1.
  it('numbers the next run after the latest run record of that child', () => {
    const history = deepFreeze([runRecord('c1', 1), runRecord('c2', 4), runRecord('c1', 2)])
    expect(withoutEnvironment(() => nextRun(history, thread('c1')))).toBe(3)
    expect(nextRun(history, thread('c3'))).toBe(1)
  })
})
