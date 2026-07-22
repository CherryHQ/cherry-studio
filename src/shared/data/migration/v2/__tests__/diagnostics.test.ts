import { describe, expect, it } from 'vitest'

import {
  getMigrationDiagnosticNoticeParts,
  type MigrationDiagnosticNoticePart,
  type MigrationDiagnosticSavedResult,
  serializeMigrationDiagnosticError
} from '../diagnostics'

describe('getMigrationDiagnosticNoticeParts', () => {
  it.each<[MigrationDiagnosticSavedResult, readonly MigrationDiagnosticNoticePart[]]>([
    [{ status: 'saved', logs: 'included', size: 'standard' }, ['logs_included', 'not_uploaded']],
    [
      { status: 'saved', logs: 'not_included', retry: 'suggested', size: 'standard' },
      ['logs_not_included_retry_suggested', 'not_uploaded']
    ],
    [
      { status: 'saved', logs: 'not_included', retry: 'not_suggested', size: 'standard' },
      ['logs_not_included_retry_not_suggested', 'not_uploaded']
    ],
    [{ status: 'saved', logs: 'included', size: 'large' }, ['logs_included', 'large', 'not_uploaded']],
    [
      { status: 'saved', logs: 'not_included', retry: 'suggested', size: 'large' },
      ['logs_not_included_retry_suggested', 'large', 'not_uploaded']
    ]
  ])('returns the ordered notice parts for %o', (result, expected) => {
    expect(getMigrationDiagnosticNoticeParts(result)).toEqual(expected)
  })
})

describe('serializeMigrationDiagnosticError', () => {
  it('preserves the complete stack and filesystem metadata', () => {
    const error = Object.assign(new Error('permission denied'), {
      stack: 'Error: permission denied\n    at readLogs (/app/main.js:42:7)',
      code: 'EACCES',
      syscall: 'open',
      path: '/Users/test/Library/Logs/CherryStudio/app.2026-07-22.log'
    })

    expect(serializeMigrationDiagnosticError(error)).toEqual({
      name: 'Error',
      message: 'permission denied',
      stack: 'Error: permission denied\n    at readLogs (/app/main.js:42:7)',
      code: 'EACCES',
      syscall: 'open',
      path: '/Users/test/Library/Logs/CherryStudio/app.2026-07-22.log'
    })
  })

  it('uses the attempted absolute path when the error does not carry one', () => {
    const error = Object.assign(new Error('unreadable'), { stack: 'Error: unreadable\n    at readLogs' })

    expect(serializeMigrationDiagnosticError(error, '/absolute/app.log')).toEqual({
      name: 'Error',
      message: 'unreadable',
      stack: 'Error: unreadable\n    at readLogs',
      path: '/absolute/app.log'
    })
  })

  it('omits an inaccessible stack without masking the original error', () => {
    const error = new Error('permission denied')
    Object.defineProperty(error, 'stack', {
      get: () => {
        throw new Error('stack getter failed')
      }
    })

    expect(serializeMigrationDiagnosticError(error)).toEqual({
      name: 'Error',
      message: 'permission denied'
    })
  })

  it('reads the stack only once', () => {
    let stackReads = 0
    const error = { name: 'Error', message: 'permission denied' }
    Object.defineProperty(error, 'stack', {
      get: () => {
        stackReads += 1
        return 'Error: permission denied\n    at readLogs'
      }
    })

    expect(serializeMigrationDiagnosticError(error)).toEqual({
      name: 'Error',
      message: 'permission denied',
      stack: 'Error: permission denied\n    at readLogs'
    })
    expect(stackReads).toBe(1)
  })

  it('records non-Error throws without inventing a stack', () => {
    expect(serializeMigrationDiagnosticError('collector failed', '/absolute/logs')).toEqual({
      name: 'NonError',
      message: 'collector failed',
      path: '/absolute/logs'
    })
  })
})
