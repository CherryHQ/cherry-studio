import { describe, expect, it } from 'vitest'

import { fromRemoteError, toRemoteError } from '../protocol/remoteError'

/** Neither `JSON.stringify` nor `String()` can render this: circular *and* without a prototype. */
function unrenderable(): object {
  const value = Object.create(null) as { self?: unknown }
  value.self = value
  return value
}

describe('toRemoteError', () => {
  it('produces a structured-cloneable shape for a value that cannot be stringified', () => {
    const shape = toRemoteError(unrenderable())
    expect(() => structuredClone(shape)).not.toThrow()
    expect(shape.name).toBe('Error')
  })

  it('produces a structured-cloneable shape for an Error whose accessors throw', () => {
    class Nasty extends Error {
      override get message(): string {
        throw new Error('message getter exploded')
      }
    }
    const shape = toRemoteError(new Nasty())
    expect(() => structuredClone(shape)).not.toThrow()
    expect(fromRemoteError(shape)).toBeInstanceOf(Error)
  })

  it('keeps the name, message and string code of an ordinary error', () => {
    const error = Object.assign(new TypeError('bad input'), { code: 'ERR_BAD' })
    expect(toRemoteError(error)).toMatchObject({ name: 'TypeError', message: 'bad input', code: 'ERR_BAD' })
  })

  describe.each(['name', 'message'] as const)('malformed %s', (field) => {
    it.each([
      { value: Symbol('reason'), expected: 'Symbol(reason)' },
      { value: 42, expected: '42' },
      { value: { [Symbol.toPrimitive]: () => 'detail' }, expected: 'detail' }
    ])('converts $expected to a primitive string safe for transport and interpolation', ({ value, expected }) => {
      const error = Object.assign(new Error('init failed'), { stack: 'saved stack', [field]: value })

      const shape = toRemoteError(error)

      expect(shape[field]).toBe(expected)
      expect(typeof shape.name).toBe('string')
      expect(typeof shape.message).toBe('string')
      expect(structuredClone(shape)).toEqual(shape)
      expect(() => `${fromRemoteError(shape)}`).not.toThrow()
    })

    it('falls back to primitive strings when field conversion throws', () => {
      const error = Object.assign(new Error('init failed'), { stack: 'saved stack', [field]: unrenderable() })

      const shape = toRemoteError(error)

      expect(typeof shape.name).toBe('string')
      expect(typeof shape.message).toBe('string')
      expect(structuredClone(shape)).toEqual(shape)
      expect(() => `${fromRemoteError(shape)}`).not.toThrow()
    })
  })
})
