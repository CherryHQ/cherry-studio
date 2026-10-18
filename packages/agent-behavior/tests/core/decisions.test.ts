import { describe, expect, expectTypeOf, it } from 'vitest'

import type { ItemId, JsonValue } from '@cherrystudio/agent-runtime'

import { type BehaviorEvent, type Effect, type Step, type TxOp, turnInput } from '../../src/core/decisions'
import { decodeEntry } from '../../src/core/entryCodec'
import type { MarkerFact, PolicyRecord } from '../../src/core/facts'
import { keys } from '../../src/core/keys'
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
})
