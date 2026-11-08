import { describe, expect, it } from 'vitest'

import { resolveResendModelIds } from '../resendModelIds'

describe('resolveResendModelIds', () => {
  // Catches dispatch and validation disagreeing about inherited model membership.
  it('preserves multiple models with an assistant', () => {
    expect(resolveResendModelIds(['provider::a', 'provider::b'], true)).toEqual(['provider::a', 'provider::b'])
  })

  it('uses the assistant default for a single inherited model', () => {
    expect(resolveResendModelIds(['provider::a'], true)).toEqual([])
  })

  it('preserves a single model without an assistant', () => {
    expect(resolveResendModelIds(['provider::a'], false)).toEqual(['provider::a'])
  })

  it('returns no models for an empty inheritance', () => {
    expect(resolveResendModelIds([], false)).toEqual([])
  })
})
