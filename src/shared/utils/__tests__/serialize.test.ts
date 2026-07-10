import { describe, expect, it } from 'vitest'

import { safeSerialize } from '../serialize'

describe('safeSerialize', () => {
  describe('serializable values', () => {
    it('should serialize plain objects with pretty printing by default', () => {
      expect(safeSerialize({ a: 1 })).toBe('{\n  "a": 1\n}')
    })

    it('should serialize compactly when pretty is false', () => {
      expect(safeSerialize({ a: 1, b: [2, 3] }, { pretty: false })).toBe('{"a":1,"b":[2,3]}')
    })

    it.each([
      ['null', null, 'null'],
      ['string', 'hello', '"hello"'],
      ['number', 42, '42'],
      ['boolean', true, 'true']
    ])('should serialize %s', (_, value, expected) => {
      expect(safeSerialize(value, { pretty: false })).toBe(expected)
    })
  })

  describe('non-serializable values with default (serialize) mode', () => {
    it('should convert Date to ISO string', () => {
      const date = new Date('2020-01-01T00:00:00.000Z')
      expect(safeSerialize(date, { pretty: false })).toBe('"2020-01-01T00:00:00.000Z"')
    })

    it('should convert Set to array', () => {
      expect(safeSerialize(new Set([1, 2, 3]), { pretty: false })).toBe('[1,2,3]')
    })

    it('should convert Map to object', () => {
      expect(safeSerialize(new Map([['a', 1]]), { pretty: false })).toBe('{"a":1}')
    })

    it('should convert RegExp to a marker', () => {
      expect(safeSerialize(/abc/g, { pretty: false })).toBe('"{RegExp: \\"/abc/g\\"}"')
    })

    it('should convert function to a marker', () => {
      expect(safeSerialize({ fn: function named() {} }, { pretty: false })).toBe('{"fn":"[Function: named]"}')
    })

    it('should mark circular references without throwing', () => {
      const obj: Record<string, unknown> = { a: 1 }
      obj.self = obj
      expect(safeSerialize(obj, { pretty: false })).toBe('{"a":1,"self":"[Circular]"}')
    })

    // Regression: bigint is not JSON-serializable; the best-effort serializer must
    // not throw on it.
    it('should convert a top-level bigint to a string', () => {
      expect(safeSerialize(BigInt(10), { pretty: false })).toBe('"10"')
    })

    it('should convert a nested bigint to a string', () => {
      expect(safeSerialize({ big: BigInt('9007199254740993') }, { pretty: false })).toBe('{"big":"9007199254740993"}')
    })
  })

  describe('onError modes', () => {
    it('should throw in error mode for non-serializable values', () => {
      expect(() => safeSerialize(BigInt(1), { onError: 'error' })).toThrow(TypeError)
    })

    it('should return null in omit mode for non-serializable values', () => {
      expect(safeSerialize(new Date(), { onError: 'omit' })).toBeNull()
    })

    it('should still serialize valid values in error mode', () => {
      expect(safeSerialize({ a: 1 }, { onError: 'error', pretty: false })).toBe('{"a":1}')
    })
  })
})
