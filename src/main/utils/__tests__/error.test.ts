import { describe, expect, it } from 'vitest'

import { getErrorMessage } from '../error'

describe('getErrorMessage', () => {
  it.each([
    [undefined, 'undefined'],
    [null, 'null'],
    [false, 'false'],
    [0, '0'],
    ['', ''],
    [42n, '42'],
    [Symbol('reason'), 'Symbol(reason)']
  ])('preserves ordinary rejection text for %s', (value, expected) => {
    expect(getErrorMessage(value, 'Message unavailable')).toBe(expected)
  })

  it('preserves the message of a real Error', () => {
    expect(getErrorMessage(new Error('request failed'), 'Message unavailable')).toBe('request failed')
  })

  it('contains a failure to stringify a rejection or its Error.message', () => {
    const value = { toString: null, valueOf: null }
    const error = Object.defineProperty(new Error('failed'), 'message', { value })

    expect(getErrorMessage(value, 'Message unavailable')).toBe('Message unavailable')
    expect(getErrorMessage(error, 'Message unavailable')).toBe('Message unavailable')
  })
})
