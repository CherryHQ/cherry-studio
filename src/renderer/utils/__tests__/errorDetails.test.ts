import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatErrorDetails } from '../errorDetails'

describe('formatErrorDetails', () => {
  it('returns the message directly when the error has one', () => {
    expect(formatErrorDetails(new Error('Test error'))).toBe('Test error')
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
  const HEAVY_DEPS = ['zod', 'ai', 'axios']
  let loaded: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    loaded = vi.fn()
    for (const dep of HEAVY_DEPS) {
      vi.doMock(dep, () => {
        loaded(dep)
        return {}
      })
    }
  })

  afterEach(() => {
    for (const dep of HEAVY_DEPS) {
      vi.doUnmock(dep)
    }
    vi.resetModules()
  })

  // The control lives in the same test as the assertion: split across two tests, the
  // second one raced the mocked-module cache (factory already run under the previous
  // `loaded` spy) and flaked.
  it('does not evaluate zod/ai/axios when utils/errorDetails is imported', async () => {
    await import('../errorDetails')
    expect(loaded).not.toHaveBeenCalled()

    // control: the same doMock layer does fire when a heavy dep is actually reached.
    for (const dep of HEAVY_DEPS) {
      await import(dep)
    }
    expect(loaded).toHaveBeenCalledTimes(HEAVY_DEPS.length)
  })
})
