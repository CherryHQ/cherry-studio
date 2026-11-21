import { expect, it } from 'vitest'

import { nullsToUndefined } from '../rowMappers'

it('converts only top-level nulls while preserving literal field names and source values', () => {
  const nested = { nullable: null }
  const timestamp = new Date(0)
  const row = Object.freeze({
    ['__proto__']: nested,
    constructor: 'stored constructor',
    nullable: null,
    absent: undefined,
    zero: 0,
    empty: '',
    disabled: false,
    timestamp
  })

  const result = nullsToUndefined(row)

  expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  expect(Object.getOwnPropertyDescriptor(result, '__proto__')).toEqual({
    value: nested,
    enumerable: true,
    configurable: true,
    writable: true
  })
  expect(Object.keys(result)).toEqual(Object.keys(row))
  expect(result.constructor).toBe('stored constructor')
  expect(result.nullable).toBeUndefined()
  expect(result.absent).toBeUndefined()
  expect(result.zero).toBe(0)
  expect(result.empty).toBe('')
  expect(result.disabled).toBe(false)
  expect(result.timestamp).toBe(timestamp)
  expect(result.__proto__).toBe(nested)
  expect(nested.nullable).toBeNull()
  expect(row.nullable).toBeNull()
  expect(Object.getPrototypeOf(row)).toBe(Object.prototype)
})
