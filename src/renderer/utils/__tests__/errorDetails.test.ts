import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatErrorDetails } from '../errorDetails'

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

  it('probe control: a static heavy-dependency graph activates the interception layer', async () => {
    await import('./fixtures/errorDetailsHeavyProbe')

    // Any single probe firing proves the hoisted interception layer is alive.
    expect(loaded).toHaveBeenCalled()
  })
})
