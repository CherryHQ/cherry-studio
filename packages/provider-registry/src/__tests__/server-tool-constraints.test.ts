import { describe, expect, it } from 'vitest'

import { isWebSearchEffortUnsupported } from '../patterns/serverToolConstraints'

describe('provider-native web-search effort constraints', () => {
  it('rejects only the declared effort for a constrained model', () => {
    expect(isWebSearchEffortUnsupported('gpt-5', 'minimal')).toBe(true)
    expect(isWebSearchEffortUnsupported('gpt-5', 'high')).toBe(false)
  })

  it.each(['constructor', '__proto__', 'toString'])('treats an undeclared model as unconstrained: %s', (modelId) => {
    expect(isWebSearchEffortUnsupported(modelId, 'minimal')).toBe(false)
  })
})
