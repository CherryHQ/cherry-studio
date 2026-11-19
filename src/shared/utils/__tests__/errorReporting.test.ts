import { describe, expect, it } from 'vitest'

import { hasReportingOwner, isCancellation, markReportingHandled } from '../errorReporting'

describe('failure classification and reporting ownership', () => {
  it.each([{ name: 'AbortError' }, { name: 'CanceledError' }, { code: 'ABORT_ERR' }, { code: 'ERR_CANCELED' }])(
    'recognizes cancellation marker %j',
    (error) => {
      expect(isCancellation(error)).toBe(true)
    }
  )

  it('does not let unreadable fields replace an unclassified failure', () => {
    const error = {
      get name() {
        throw new Error('unreadable name')
      },
      get reportingHandled() {
        throw new Error('unreadable ownership')
      }
    }

    expect(isCancellation(error)).toBe(false)
    expect(hasReportingOwner(error)).toBe(false)
  })

  it('does not inspect unrelated fields after a recognized cancellation name', () => {
    const error = {
      name: 'AbortError',
      get code() {
        throw new Error('unreadable code')
      }
    }

    expect(isCancellation(error)).toBe(true)
  })

  it('records ownership on ordinary mutable errors', () => {
    const error = new Error('original failure')

    markReportingHandled(error)
    markReportingHandled(error)

    expect(hasReportingOwner(error)).toBe(true)
    expect(error.message).toBe('original failure')
  })

  it('preserves errors with frozen or read-only ownership metadata', () => {
    const readOnlyError = Object.defineProperty(new Error('original failure'), 'reportingHandled', { value: false })
    const frozenError = Object.freeze(new Error('frozen failure'))

    expect(() => markReportingHandled(readOnlyError)).not.toThrow()
    expect(() => markReportingHandled(frozenError)).not.toThrow()
    expect(readOnlyError.message).toBe('original failure')
    expect(hasReportingOwner(readOnlyError)).toBe(false)
    expect(hasReportingOwner(frozenError)).toBe(false)
  })
})
