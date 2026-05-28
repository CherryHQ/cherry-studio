import { describe, expect, it } from 'vitest'

import { BackupCancelledError, CancellationToken } from '../CancellationToken'

describe('CancellationToken', () => {
  it('starts in non-cancelled state', () => {
    const token = new CancellationToken()
    expect(token.isCancelled).toBe(false)
  })

  it('transitions to cancelled state', () => {
    const token = new CancellationToken()
    token.cancel()
    expect(token.isCancelled).toBe(true)
  })

  it('throwIfCancelled does not throw when not cancelled', () => {
    const token = new CancellationToken()
    expect(() => token.throwIfCancelled()).not.toThrow()
  })

  it('throwIfCancelled throws BackupCancelledError when cancelled', () => {
    const token = new CancellationToken()
    token.cancel()
    expect(() => token.throwIfCancelled()).toThrow(BackupCancelledError)
  })

  it('cancel is idempotent', () => {
    const token = new CancellationToken()
    token.cancel()
    token.cancel()
    expect(token.isCancelled).toBe(true)
  })
})

describe('BackupCancelledError', () => {
  it('has correct name and message', () => {
    const error = new BackupCancelledError()
    expect(error.name).toBe('BackupCancelledError')
    expect(error.message).toBe('Backup operation cancelled')
    expect(error).toBeInstanceOf(Error)
  })
})
