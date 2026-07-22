import { describe, expect, it } from 'vitest'

import {
  getMigrationDiagnosticNoticeParts,
  type MigrationDiagnosticError,
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

  it('preserves a bounded error cause chain including native SQLite metadata', () => {
    const sqliteError = Object.assign(new Error('file is not a database'), {
      code: 'SQLITE_NOTADB'
    })
    const drizzleError = new Error('Failed query', { cause: sqliteError })

    expect(serializeMigrationDiagnosticError(drizzleError)).toMatchObject({
      name: 'Error',
      message: 'Failed query',
      cause: {
        name: 'Error',
        message: 'file is not a database',
        code: 'SQLITE_NOTADB'
      }
    })
  })

  it('marks a cyclic cause without recursing forever', () => {
    const outer = new Error('outer') as Error & { cause?: unknown }
    const inner = new Error('inner', { cause: outer })
    outer.cause = inner

    expect(serializeMigrationDiagnosticError(outer)).toMatchObject({
      message: 'outer',
      cause: {
        message: 'inner',
        causeTruncated: true
      }
    })
  })

  it('serializes at most five error levels', () => {
    const errors = Array.from({ length: 6 }, (_, index) => new Error(`level-${index}`)) as Array<
      Error & { cause?: unknown }
    >
    for (let index = 0; index < errors.length - 1; index++) errors[index].cause = errors[index + 1]

    const serialized = serializeMigrationDiagnosticError(errors[0])
    const messages: string[] = []
    let current: MigrationDiagnosticError | undefined = serialized
    while (current) {
      messages.push(current.message)
      if (current.causeTruncated) break
      current = current.cause
    }

    expect(messages).toEqual(['level-0', 'level-1', 'level-2', 'level-3', 'level-4'])
    expect(current?.causeTruncated).toBe(true)
  })
})
