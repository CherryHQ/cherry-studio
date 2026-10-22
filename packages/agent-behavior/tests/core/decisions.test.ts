import { describe, expect, expectTypeOf, it } from 'vitest'

import type { ItemId, JsonValue } from '@cherrystudio/agent-runtime'

import { type BehaviorEvent, type Effect, type Step, type TxOp, turnInput } from '../../src/core/decisions'
import { decodeEntry } from '../../src/core/entryCodec'
import type { MarkerFact, PolicyRecord } from '../../src/core/facts'
import { keys } from '../../src/core/keys'
import { apply, PARENT } from './history'
import { withoutEnvironment } from './purity'

describe('decisions', () => {
  // Catches a decision shape memo cannot persist (an interface, Map, Date or function inside a step). Enforced by the
  // package typecheck over tests/**; the runtime body is empty.
  it('are JSON values', () => {
    expectTypeOf<Step>().toExtend<JsonValue>()
    expectTypeOf<TxOp>().toExtend<JsonValue>()
    expectTypeOf<Effect>().toExtend<JsonValue>()
    expectTypeOf<PolicyRecord>().toExtend<JsonValue>()
    expectTypeOf<MarkerFact>().toExtend<JsonValue>()
    expectTypeOf<BehaviorEvent>().toExtend<JsonValue>()
  })

  // Catches a turn input that an adapter stores as specified (key merged into data) but the core cannot read back.
  it('builds a turn input the codec reads back as the same marker', () => {
    const marker: MarkerFact = {
      type: 'goal-round',
      round: { id: 'r', goalId: 'g', revision: 1, round: 1, kind: 'work' }
    }
    const input = withoutEnvironment(() => turnInput(marker, 'Round 1'))
    const key = keys.goalRound('g', 1, 1, 1)
    const data = { ...(input.data as { readonly [field: string]: JsonValue }), key }
    expect(decodeEntry({ id: 'item-1' as ItemId, kind: input.kind, data, text: input.text })).toEqual({
      kind: 'marker',
      id: 'item-1',
      key,
      marker,
      text: 'Round 1'
    })
  })

  // Catches the core tests' history builder applying a second op under a key its step already used: the orchestration
  // drops it, so a rule that writes one key twice would pass here yet fold differently in a real harness.
  it('applies only the first op under each key of a step', () => {
    const notice = (text: string): TxOp => ({
      type: 'append-record',
      thread: PARENT,
      record: { type: 'goal-notice', value: { text, level: 'info' } },
      key: keys.goalNotice('req')
    })
    const history = apply([], { ops: [notice('first'), notice('second')], effects: [], result: null })
    expect(history.map((entry) => (entry.kind === 'record' ? entry.record : entry.kind))).toEqual([
      { type: 'goal-notice', value: { text: 'first', level: 'info' } }
    ])
  })
})
