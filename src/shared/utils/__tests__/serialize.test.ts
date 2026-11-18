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

  it('does not replace an original error with a BigInt serialization failure', () => {
    expect(safeSerialize({ cause: 1n })).toBeNull()
    expect(() => safeSerialize({ cause: 1n }, { onError: 'error' })).toThrow(TypeError)
  })

  it('returns null when an error detail throws from toJSON', () => {
    const value = {
      toJSON() {
        throw new Error('Cannot serialize provider detail')
      }
    }

    expect(safeSerialize(value)).toBeNull()
  })
})
