import { assert, describe, expect, it } from 'vitest'

import { sanitizeLogValue } from '../logSerialization'

describe('sanitizeLogValue', () => {
  it.each([4, 5])('keeps repeated projection stable for an Error at depth %s', (depth) => {
    let value: unknown = Object.assign(new Error('failure'), { status: NaN, statusCode: Infinity })
    for (let index = 0; index < depth; index++) value = { nested: value }

    const once = sanitizeLogValue(value)
    expect(sanitizeLogValue(once)).toEqual(once)
    expect(JSON.stringify(once)).toContain(depth === 5 ? '[Truncated]' : '"statusCode":null')
  })

  it('preserves prototype-named fields as own data without changing the output prototype', () => {
    const value = JSON.parse('{"__proto__":{"enabled":true},"constructor":"label"}')
    const projected = sanitizeLogValue(value)

    expect(projected).toEqual(value)
    assert(projected !== null && typeof projected === 'object')
    expect(Object.hasOwn(projected, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(projected)).toBe(Object.prototype)
    expect(sanitizeLogValue(projected)).toEqual(projected)
  })

  it('snapshots Error tags before validating and copying them', () => {
    let reads = 0
    const error = Object.defineProperty(new Error('failure'), 'statusCode', {
      get() {
        return ++reads === 1 ? 200 : () => 'not cloneable'
      }
    })
    const projected = sanitizeLogValue({ error })

    expect(projected).toMatchObject({ error: { statusCode: 200 } })
    expect(reads).toBe(1)
    // oxlint-disable-next-line no-restricted-globals -- The validated snapshot must satisfy the native clone contract.
    expect(() => structuredClone(projected)).not.toThrow()
  })

  it('does not invoke a caller-provided array map method', () => {
    const value = Object.assign([1, 2], { map: () => () => 'not cloneable' })
    expect(sanitizeLogValue(value)).toEqual([1, 2])
  })

  it('rejects a Proxy array length that would become an unprojected array entry', () => {
    let reads = 0
    const value = new Proxy([], {
      get(target, key, receiver) {
        if (key === 'length') return ++reads === 1 ? () => 'not cloneable' : 0
        return Reflect.get(target, key, receiver)
      }
    })
    const projected = sanitizeLogValue(value)

    expect(projected).toBe('<redacted>')
    expect(reads).toBe(1)
    // oxlint-disable-next-line no-restricted-globals -- Unsupported Proxy values must not escape the projection into IPC.
    expect(() => structuredClone(projected)).not.toThrow()
  })

  it('uses one validated array length snapshot while preserving sparse positions', () => {
    let reads = 0
    const sparse = new Array<number>(3)
    sparse[0] = 1
    sparse[2] = 3
    const value = new Proxy(sparse, {
      get(target, key, receiver) {
        if (key === 'length') return ++reads === 1 ? 3 : 0
        return Reflect.get(target, key, receiver)
      }
    })
    const projected = sanitizeLogValue(value)

    expect(projected).toEqual(sparse)
    assert(Array.isArray(projected))
    expect(Object.hasOwn(projected, 1)).toBe(false)
    expect(reads).toBe(1)
  })

  it('keeps valid sibling diagnostics around unsupported, circular and unreadable values', () => {
    const cycle: { self?: object } = {}
    cycle.self = cycle
    const unreadable = {
      get value() {
        throw new Error('unreadable')
      }
    }

    expect(
      sanitizeLogValue({ valid: 'keep', callback: () => {}, symbol: Symbol(), integer: 1n, cycle, unreadable })
    ).toEqual({
      valid: 'keep',
      callback: '<redacted>',
      symbol: '<redacted>',
      integer: '<redacted>',
      cycle: { self: '[Circular]' },
      unreadable: '<redacted>'
    })
  })
})
