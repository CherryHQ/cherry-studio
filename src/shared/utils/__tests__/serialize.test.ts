import { describe, expect, it } from 'vitest'

import { safeSerialize } from '../serialize'

describe('safeSerialize', () => {
  it.each(['serialize', 'omit', 'error'] as const)('preserves shared objects and arrays in %s mode', (onError) => {
    const detail = { message: 'details' }
    const items = [detail]

    expect(safeSerialize({ detail, first: items, second: items }, { onError, pretty: false })).toBe(
      '{"detail":{"message":"details"},"first":[{"message":"details"}],"second":[{"message":"details"}]}'
    )
  })

  it('still handles true cycles according to the selected mode', () => {
    const value: Record<string, unknown> = { message: 'details' }
    value.self = value

    expect(safeSerialize(value, { pretty: false })).toBe('{"message":"details","self":"[Circular]"}')
    expect(safeSerialize(value, { onError: 'omit' })).toBeNull()
    expect(() => safeSerialize(value, { onError: 'error' })).toThrow(TypeError)
  })
})
