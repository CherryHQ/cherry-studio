import { describe, expect, it } from 'vitest'

import { booleanOr, controlValue, finiteNumberOr, optionalFiniteNumber, stringOr } from '../fieldValue'

describe('painting field value narrowing', () => {
  it('accepts finite numbers and the numeric strings normalized during submit', () => {
    expect(finiteNumberOr(4.5, 1)).toBe(4.5)
    expect(finiteNumberOr('4.5', 1)).toBe(4.5)
    expect(finiteNumberOr('', 1)).toBe(1)
    expect(finiteNumberOr(Number.NaN, 1)).toBe(1)
    expect(optionalFiniteNumber(0)).toBe(0)
    expect(optionalFiniteNumber('0')).toBe(0)
    expect(optionalFiniteNumber('not-a-number')).toBeNull()
  })

  it('does not stringify objects or reinterpret truthy values', () => {
    expect(stringOr('seed', 'fallback')).toBe('seed')
    expect(stringOr(42, 'fallback')).toBe('fallback')
    expect(booleanOr(false, true)).toBe(false)
    expect(booleanOr('false', true)).toBe(true)
  })

  it('serializes only supported primitive control values', () => {
    expect(controlValue('1:1')).toBe('1:1')
    expect(controlValue(2)).toBe('2')
    expect(controlValue(Number.NaN)).toBe('')
    expect(controlValue({ value: '1:1' })).toBe('')
  })
})
