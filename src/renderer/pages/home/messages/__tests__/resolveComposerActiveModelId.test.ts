import { describe, expect, it } from 'vitest'

import { resolveComposerActiveModelId } from '../resolveComposerActiveModelId'

describe('resolveComposerActiveModelId', () => {
  it('returns the sole selector model when exactly one is selected', () => {
    expect(resolveComposerActiveModelId([{ id: 'provider-a::model-x' }])).toBe('provider-a::model-x')
  })

  it('returns undefined when multiple selector models are active', () => {
    expect(resolveComposerActiveModelId([{ id: 'provider-a::model-x' }, { id: 'provider-b::model-y' }])).toBeUndefined()
  })

  it('returns undefined when the selector is empty', () => {
    expect(resolveComposerActiveModelId([])).toBeUndefined()
  })
})
