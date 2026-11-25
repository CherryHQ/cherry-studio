import { expect, it } from 'vitest'

import { modeWire } from '../providers/wires'
import { ReasoningWireProfileSchema } from '../schemas/reasoningWire'

it('accepts an effort marker by value without relying on exported object identity', () => {
  const profile = ReasoningWireProfileSchema.parse(modeWire('reasoningEffort', { effort: { source: 'effort' } }))

  expect(profile.effort?.operations).toEqual([{ target: 'reasoningEffort', value: { source: 'effort' } }])
})
