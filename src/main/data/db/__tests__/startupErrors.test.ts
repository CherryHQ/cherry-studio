import { describe, expect, it } from 'vitest'

import { classifyDatabaseFailure } from '../startupErrors'

describe('startup database failures', () => {
  it.each([
    ['SQLITE_IOERR_TRUNCATE', 'io'],
    ['SQLITE_BUSY_RECOVERY', 'busy'],
    ['SQLITE_CORRUPT_INDEX', 'corrupt'],
    ['SQLITE_FULL', 'full'],
    ['SQLITE_READONLY_DIRECTORY', 'access'],
    ['EACCES', 'access']
  ])('classifies a nested %s without relying on SQL text', (code, kind) => {
    expect(classifyDatabaseFailure(new Error('Failed query', { cause: { cause: { code } } }))).toEqual({ kind, code })
  })

  it('does not treat SQL mentioning an error code as a driver error', () => {
    expect(classifyDatabaseFailure(new Error("INSERT INTO message VALUES ('SQLITE_BUSY')"))).toEqual({
      kind: 'unknown'
    })
  })

  it('terminates on cyclic error chains', () => {
    const error = { cause: {} }
    error.cause = error
    expect(classifyDatabaseFailure(error)).toEqual({ kind: 'unknown' })
  })
})
