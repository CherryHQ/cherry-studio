import { describe, expect, it } from 'vitest'

import type { ItemId, JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import { decodeEntry, encodeEntry } from '../../src/core/entryCodec'
import { callKeyOf, ENTRY_KINDS, type GoalSnapshot, type MarkerFact, type PolicyRecord } from '../../src/core/facts'
import { deepFreeze, withoutEnvironment } from './purity'

const id = 'item-1' as ItemId
const child = 'child-1' as ThreadId
const goal: GoalSnapshot = {
  id: 'goal:task-1',
  revision: 2,
  objective: 'ship',
  phase: 'active',
  roundsStarted: 1,
  progressRounds: 1,
  maxGoalRounds: 20,
  tokensUsed: 10,
  costUsed: 0.5,
  wrapUpDone: false,
  armed: true,
  createdAt: 1,
  updatedAt: 2
}
const records: PolicyRecord[] = [
  { type: 'goal', value: goal },
  { type: 'goal', value: { id: 'goal:task-1', revision: 3, cleared: true, at: 5 } },
  { type: 'goal-notice', value: { text: 'paused', level: 'info' } },
  {
    type: 'subagent-run',
    value: {
      sessionId: child,
      parentToolCallId: 'call-1',
      description: 'scan',
      fork: false,
      background: true,
      modelKey: 'p/m',
      run: 1,
      status: 'finished',
      outcome: 'completed',
      report: 'done'
    }
  },
  { type: 'subagent-origin', value: { parentToolCallId: 'call-1', fork: false, description: 'scan', modelKey: 'p/m' } },
  { type: 'plan', value: { active: true, at: 7 } },
  { type: 'turn-stop', value: { cause: 'goal-command', at: 9 } },
  { type: 'idle-driver-exit', value: { generation: 2 } },
  { type: 'subagent-steer', value: { sessionId: child, run: 1, digest: 'ab12', withdrawn: false } }
]
const markers: MarkerFact[] = [
  {
    type: 'goal-round',
    round: { id: 'goal-round:goal:task-1:r2:v2:a1', goalId: 'goal:task-1', revision: 2, round: 2, kind: 'work' }
  },
  { type: 'subagent-notification', runs: [{ sessionId: child, run: 1, outcome: 'completed' }], quiet: true },
  { type: 'subagent-status' },
  { type: 'subagent-message' }
]

describe('entry kinds', () => {
  // Catches a renamed kind (every stored session entry of the old name is orphaned) or a pi.* kind Durable refuses.
  it('keeps today’s cherry.* kinds and adds plan, turn-stop, idle-driver-exit and subagent-steer', () => {
    expect(ENTRY_KINDS).toEqual({
      goal: 'cherry.goal',
      goalRound: 'cherry.goal-round',
      goalNotice: 'cherry.goal-notice',
      subagentRun: 'cherry.subagent-state',
      subagentOrigin: 'cherry.subagent-origin',
      subagentNotification: 'cherry.subagent-notification',
      subagentStatus: 'cherry.subagent-status',
      subagentMessage: 'cherry.subagent-message',
      plan: 'cherry.plan',
      turnStop: 'cherry.turn-stop',
      idleDriverExit: 'cherry.idle-driver-exit',
      subagentSteer: 'cherry.subagent-steer'
    })
  })
})

describe('entry codec', () => {
  // Catches a record that does not survive the adapter's store-and-read path, losing goal, subagent, plan or stop state.
  it.each(records.map((record) => [record.type, record] as const))(
    'round-trips the %s record with its key',
    (_type, record) => {
      const { kind, data } = encodeEntry(record, 'key-1')
      const stored = JSON.parse(JSON.stringify(data)) as JsonValue
      expect(decodeEntry({ id, kind, data: stored })).toEqual({ kind: 'record', id, key: 'key-1', record })
    }
  )

  // Catches a marker (round, notification, status, message) the core cannot recognise after the harness stores it.
  it.each(markers.map((marker) => [marker.type, marker] as const))(
    'round-trips the %s marker with its key and text',
    (_type, marker) => {
      const { kind, data } = encodeEntry(marker, 'key-2')
      const stored = JSON.parse(JSON.stringify(data)) as JsonValue
      expect(decodeEntry({ id, kind, data: stored, text: 'shown' })).toEqual({
        kind: 'marker',
        id,
        key: 'key-2',
        marker,
        text: 'shown'
      })
    }
  )

  // Review focus 1: entries agent-runtime-pi writes today (no key, Pi Usage, no details) must read back without migration.
  it('decodes entries written by agent-runtime-pi before the package existed', () => {
    const piUsage = {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
    expect(decodeEntry({ id, kind: 'cherry.goal', data: goal })).toEqual({
      kind: 'record',
      id,
      record: { type: 'goal', value: goal }
    })
    const state = {
      sessionId: 'child-1',
      parentToolCallId: 'call-1',
      description: 'scan',
      fork: false,
      background: true,
      modelKey: 'p/m',
      run: 1,
      status: 'finished',
      outcome: 'completed',
      usage: piUsage
    }
    expect(decodeEntry({ id, kind: 'cherry.subagent-state', data: state })).toEqual({
      kind: 'record',
      id,
      record: { type: 'subagent-run', value: state }
    })
    expect(
      decodeEntry({
        id,
        kind: 'cherry.subagent-notification',
        text: 'report',
        data: { subagents: [{ sessionId: 'child-1', run: 1, outcome: 'completed', usage: piUsage }] }
      })
    ).toEqual({
      kind: 'marker',
      id,
      text: 'report',
      marker: {
        type: 'subagent-notification',
        runs: [{ sessionId: child, run: 1, outcome: 'completed' }],
        quiet: false
      }
    })
    expect(decodeEntry({ id, kind: 'cherry.subagent-status', data: undefined, text: 'status' })).toEqual({
      kind: 'marker',
      id,
      text: 'status',
      marker: { type: 'subagent-status' }
    })
  })

  // Review focus 2: a foreign or corrupt entry must be skipped, not crash every read of the conversation.
  it.each([
    ['a pi.* kind', { kind: 'pi.user', data: {} }],
    ['an unknown cherry.* kind', { kind: 'cherry.unknown', data: {} }],
    ['null record data', { kind: 'cherry.goal', data: null }],
    ['a goal without id', { kind: 'cherry.goal', data: { revision: 1, phase: 'active', armed: true } }],
    ['a notice with an unknown level', { kind: 'cherry.goal-notice', data: { text: 'x', level: 'loud' } }],
    ['a non-string key', { kind: 'cherry.plan', data: { active: true, at: 1, key: 5 } }],
    ['a notification without a run list', { kind: 'cherry.subagent-notification', data: { subagents: 'all' } }],
    // Catches an outcome or stopper outside its union decoded as one, which the rules would then trust.
    [
      'a notified run with an unknown outcome',
      { kind: 'cherry.subagent-notification', data: { subagents: [{ sessionId: 'c', run: 1, outcome: 'exploded' }] } }
    ],
    [
      'a run record with an unknown stopper',
      { kind: 'cherry.subagent-state', data: { sessionId: 'c', run: 1, status: 'finished', stoppedBy: 'cat' } }
    ],
    // Catches a stop cause outside its union, or none, decoded as one, which the rules would then trust.
    ['a turn stop with an unknown cause', { kind: 'cherry.turn-stop', data: { at: 1, cause: 'cat' } }],
    ['a turn stop without a cause', { kind: 'cherry.turn-stop', data: { at: 1 } }]
  ] as const)('skips %s without throwing', (_name, raw) => {
    expect(decodeEntry({ id, ...raw })).toBeUndefined()
  })

  // Catches codec code that reads the clock, randomness or mutates the stored data it was handed (§11.10).
  it('is pure', () => {
    const raw = deepFreeze({ id, kind: ENTRY_KINDS.goal, data: { ...goal, key: 'k' } })
    const first = withoutEnvironment(() => decodeEntry(raw))
    expect(withoutEnvironment(() => decodeEntry(raw))).toEqual(first)
    expect(withoutEnvironment(() => encodeEntry(deepFreeze(records[3]), 'k'))).toEqual(encodeEntry(records[3], 'k'))
  })

  // Catches an adapter passing an empty task id, which would give every such call the same identity.
  it('refuses an empty call key', () => {
    expect(() => callKeyOf('')).toThrow(TypeError)
    expect(() => callKeyOf('  ')).toThrow(TypeError)
    expect(callKeyOf('task-7')).toBe('task-7')
  })
})
