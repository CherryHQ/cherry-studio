import { describe, expect, it } from 'vitest'

import { getErrorCode, getErrorMessage } from '../error'

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

describe('getErrorCode', () => {
  it.each(['ENOENT', 'EACCES', 'EXDEV', 'SQLITE_CONSTRAINT', ''])('preserves the string code %s', (code) => {
    expect(getErrorCode(Object.assign(new Error('failed'), { code }))).toBe(code)
    expect(getErrorCode({ code })).toBe(code)
  })

  it.each([undefined, null, false, 0, 'ENOENT', 42n, Symbol('reason')])(
    'does not infer a code from the rejection value %s',
    (value) => {
      expect(getErrorCode(value)).toBeUndefined()
    }
  )

  it.each([undefined, null, false, 0, ['ENOENT'], { toString: () => 'ENOENT' }])(
    'does not coerce a non-string code %s',
    (code) => {
      expect(getErrorCode({ code })).toBeUndefined()
    }
  )

  it('reads code from callable and inherited error values', () => {
    expect(getErrorCode(Object.assign(() => undefined, { code: 'EIO' }))).toBe('EIO')
    expect(getErrorCode(Object.create({ code: 'ENOTDIR' }))).toBe('ENOTDIR')
  })

  it('uses a single code observation without inspecting the message', () => {
    let reads = 0
    const error = {
      get code() {
        return reads++ === 0 ? 'EXDEV' : 'EIO'
      },
      get message() {
        throw new Error('unreadable message')
      }
    }

    expect(getErrorCode(error)).toBe('EXDEV')
  })

  it('preserves a virtual code field without requiring a has trap', () => {
    const error = new Proxy({}, { get: (_target, key) => (key === 'code' ? 'ENOENT' : undefined) })

    expect(getErrorCode(error)).toBe('ENOENT')
  })

  it('leaves unreadable codes unclassified', () => {
    const error = {
      get code() {
        throw new Error('unreadable code')
      }
    }
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()

    expect(getErrorCode(error)).toBeUndefined()
    expect(getErrorCode(revoked.proxy)).toBeUndefined()
  })
})
