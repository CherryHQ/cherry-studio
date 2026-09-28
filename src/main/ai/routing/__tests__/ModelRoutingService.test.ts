import { describe, expect, it } from 'vitest'

import type { RoutableModel } from '../deriveRoutingTable'
import { fingerprintOf } from '../ModelRoutingService'

const model = (overrides: Partial<RoutableModel> = {}): RoutableModel => ({
  id: 'openai::gpt-4o',
  providerId: 'openai',
  capabilities: [],
  ...overrides
})

describe('fingerprintOf', () => {
  it('changes when a model gains a capability, even though the model id set is unchanged', () => {
    const before = fingerprintOf([model({ capabilities: [] })], new Set())
    const after = fingerprintOf([model({ capabilities: ['function_call'] })], new Set())

    expect(after).not.toBe(before)
  })

  it('changes when a model gains an output modality, even though the model id set is unchanged', () => {
    const before = fingerprintOf([model({ outputModalities: undefined })], new Set())
    const after = fingerprintOf([model({ outputModalities: ['image'] })], new Set())

    expect(after).not.toBe(before)
  })

  it('is stable across re-derivations of the same input, regardless of array order', () => {
    const a = fingerprintOf([model({ capabilities: ['reasoning', 'function_call'] })], new Set(['openai']))
    const b = fingerprintOf([model({ capabilities: ['function_call', 'reasoning'] })], new Set(['openai']))

    expect(a).toBe(b)
  })
})
