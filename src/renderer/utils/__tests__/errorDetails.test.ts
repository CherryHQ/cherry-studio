import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatErrorDetails, readErrorMessage, toError } from '../errorDetails'

const loaded = vi.hoisted(() => vi.fn())

vi.mock('zod', () => {
  loaded('zod')
  return {}
})

vi.mock('ai', () => {
  loaded('ai')
  return {}
})

vi.mock('axios', () => {
  loaded('axios')
  return {}
})

describe('formatErrorDetails', () => {
  it('keeps readable failure text when unrelated details cannot be encoded as JSON', () => {
    expect(formatErrorDetails({ message: 'Request failed', count: 1n })).toBe('Request failed')
    expect(formatErrorDetails(1n)).toBe('Error Details:\n  1')
  })

  it('returns detail text instead of a malformed object-valued message', () => {
    const output = formatErrorDetails({ message: { detail: 'failure' }, headers: { Authorization: 'secret' } })
    expect(JSON.parse(output.slice('Error Details:'.length))).toEqual({ message: { detail: 'failure' } })
    expect(output).not.toContain('secret')
  })

  it('returns the message directly when the error has one', () => {
    expect(formatErrorDetails(new Error('Test error'))).toBe('Test error')
  })

  it('keeps an error with a circular cause displayable', () => {
    const error = new Error('Test error')
    error.cause = error

    expect(formatErrorDetails(error)).toBe('Test error')
  })

  it('serializes circular diagnostic data while keeping its readable fields', () => {
    const error: Record<string, unknown> = { code: 500 }
    error.self = error

    const result = formatErrorDetails(error)
    expect(JSON.parse(result.slice('Error Details:'.length))).toMatchObject({ code: 500 })
  })

  it('keeps repeated non-circular properties readable', () => {
    const detail = { code: 500 }

    const result = formatErrorDetails({ first: detail, second: detail })
    expect(JSON.parse(result.slice('Error Details:'.length))).toMatchObject({
      first: { code: 500 },
      second: { code: 500 }
    })
  })

  it('returns an indented JSON dump when the error has no message', () => {
    const result = formatErrorDetails({ code: 500, status: 'Internal Server Error' })

    expect(result).toContain('Error Details:')
    expect(result).toContain('"code": 500')
    expect(result).toContain('"status": "Internal Server Error"')
  })

  it('returns an empty string for falsy/empty errors without throwing', () => {
    expect(formatErrorDetails(null)).toBe('')
    expect(formatErrorDetails(undefined)).toBe('')
    expect(formatErrorDetails('')).toBe('')
  })

  it('strips headers, stack and request_id from the details dump', () => {
    const result = formatErrorDetails({
      code: 500,
      headers: { Authorization: 'Bearer token' },
      stack: 'Error stack trace',
      request_id: '12345'
    })

    expect(result).toContain('"code": 500')
    expect(result).not.toContain('headers')
    expect(result).not.toContain('stack')
    expect(result).not.toContain('request_id')
  })
})

describe('rejection normalization', () => {
  it('preserves native Error identity and readable values including falsy rejections', () => {
    const original = new Error('original')
    expect(toError(original)).toBe(original)
    for (const [input, text] of [
      [undefined, 'undefined'],
      [null, 'null'],
      [false, 'false'],
      [0, '0'],
      ['', '']
    ]) {
      expect(readErrorMessage(input)).toBe(text)
      expect(toError(input).message).toBe(text)
    }
  })

  it('keeps failure handling usable when a rejection or native message is unreadable', () => {
    const native = new Error('original')
    Object.defineProperty(native, 'message', {
      get() {
        throw new Error('message unavailable')
      }
    })
    expect(readErrorMessage(native)).toBe('[Unserializable]')
    expect(toError(native)).toBe(native)
    expect(toError(Object.create(null)).message).toBe('[Unserializable]')
  })
})

// B6: errorDetails sits on every window's fatal-fallback path (incl. the lightest
// selection toolbar), so it must never statically reach the heavy error bucket.
describe('errorDetails light import graph (B6)', () => {
  beforeEach(() => {
    vi.resetModules()
    loaded.mockClear()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('does not evaluate zod/ai/axios when utils/errorDetails is imported', async () => {
    await import('../errorDetails')

    expect(loaded).not.toHaveBeenCalled()
  })
})
