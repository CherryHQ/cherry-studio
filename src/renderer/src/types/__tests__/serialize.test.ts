import { describe, expect, it } from 'vitest'

import { isSerializable, SerializableSchema } from '../serialize'

describe('isSerializable', () => {
  describe('primitives', () => {
    it.each([
      ['null', null],
      ['string', 'hello'],
      ['empty string', ''],
      ['number', 42],
      ['zero', 0],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['negative number', -3.14],
      ['true', true],
      ['false', false]
    ])('should accept %s', (_, value) => {
      expect(isSerializable(value)).toBe(true)
    })
  })

  describe('non-serializable primitives', () => {
    it.each([
      ['undefined', undefined],
      ['symbol', Symbol('test')],
      ['bigint', BigInt(123)],
      ['function', () => {}]
    ])('should reject %s', (_, value) => {
      expect(isSerializable(value)).toBe(false)
    })
  })

  describe('arrays', () => {
    it('should accept empty array', () => {
      expect(isSerializable([])).toBe(true)
    })

    it('should accept array of primitives', () => {
      expect(isSerializable([1, 'two', true, null])).toBe(true)
    })

    it('should accept nested arrays', () => {
      expect(
        isSerializable([
          [1, 2],
          [3, [4, 5]]
        ])
      ).toBe(true)
    })

    it('should reject array containing undefined', () => {
      expect(isSerializable([1, undefined, 3])).toBe(false)
    })

    it('should reject array containing function', () => {
      expect(isSerializable([1, () => {}, 3])).toBe(false)
    })
  })

  describe('plain objects', () => {
    it('should accept empty object', () => {
      expect(isSerializable({})).toBe(true)
    })

    it('should accept object with primitive values', () => {
      expect(isSerializable({ a: 1, b: 'two', c: true, d: null })).toBe(true)
    })

    it('should accept deeply nested objects', () => {
      expect(isSerializable({ a: { b: { c: { d: 1 } } } })).toBe(true)
    })

    it('should accept object with array values', () => {
      expect(isSerializable({ items: [1, 2, 3] })).toBe(true)
    })

    it('should reject object with undefined value', () => {
      expect(isSerializable({ a: undefined })).toBe(false)
    })

    it('should reject object with function value', () => {
      expect(isSerializable({ fn: () => {} })).toBe(false)
    })
  })

  describe('built-in objects', () => {
    it.each([
      ['Date', new Date()],
      ['RegExp', /test/],
      ['Map', new Map()],
      ['Set', new Set()],
      ['Error', new Error('test')]
    ])('should reject %s', (_, value) => {
      expect(isSerializable(value)).toBe(false)
    })
  })

  describe('class instances', () => {
    it('should reject class instances (non-plain objects)', () => {
      class Foo {
        x = 1
      }
      expect(isSerializable(new Foo())).toBe(false)
    })
  })

  describe('circular references', () => {
    it('should reject circular reference in object', () => {
      const obj: Record<string, unknown> = { a: 1 }
      obj.self = obj
      expect(isSerializable(obj)).toBe(false)
    })

    it('should reject circular reference in array', () => {
      const arr: unknown[] = [1, 2]
      arr.push(arr)
      expect(isSerializable(arr)).toBe(false)
    })
  })
})

describe('SerializableSchema', () => {
  it('should accept valid serializable values', () => {
    const value = { a: 1, b: [true, 'hello', null], c: { nested: 42 } }
    expect(SerializableSchema.safeParse(value).success).toBe(true)
  })

  it('should reject non-serializable values', () => {
    expect(SerializableSchema.safeParse(undefined).success).toBe(false)
    expect(SerializableSchema.safeParse(() => {}).success).toBe(false)
    expect(SerializableSchema.safeParse(new Date()).success).toBe(false)
  })

  it('should have consistent behavior with isSerializable', () => {
    const cases = [null, 42, 'str', true, [1, 2], { a: 1 }, undefined, new Date(), new Map(), () => {}]
    for (const value of cases) {
      expect(SerializableSchema.safeParse(value).success).toBe(isSerializable(value))
    }
  })
})
