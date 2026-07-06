import { loggerService } from '@logger'
import { DataApiError, DataApiErrorFactory, ErrorCode } from '@shared/data/api/errors'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

import { classifySqliteError, defaultHandlersFor, type SqliteErrorHandlers, withSqliteErrors } from '../sqliteErrors'

/**
 * Build a synthetic error that mimics a raw better-sqlite3 SqliteError:
 *   - an Error instance
 *   - a `.code` property matching SQLite extended error codes
 *   - a `.message` matching the authentic SQLite text format
 */
function makeSqliteError(code: string, message: string): Error {
  const err = new Error(message)
  ;(err as Error & { code: string }).code = code
  return err
}

/**
 * Wrap an inner error in an outer Error with `.cause = inner`, mimicking the
 * DrizzleQueryError layering that callers actually see.
 */
function wrapInDrizzleError(inner: Error): Error {
  const outer = new Error('Failed query: insert into ...')
  ;(outer as Error & { cause: unknown }).cause = inner
  return outer
}

/**
 * Invoke `fn` and return the value it throws. `withSqliteErrors` is now a
 * synchronous call (better-sqlite3 engine), so a constraint violation surfaces
 * as a thrown value rather than a rejected promise — capture it to assert on
 * its shape. Throws if `fn` returns normally so a missing throw never passes
 * silently.
 */
function captureThrow(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('expected fn to throw, but it returned normally')
}

describe('classifySqliteError', () => {
  let warnSpy: MockInstance

  beforeEach(() => {
    warnSpy = vi.spyOn(loggerService, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('classifies UNIQUE from an unwrapped SqliteError', () => {
    const e = makeSqliteError('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed: tag.name')
    expect(classifySqliteError(e)).toEqual({ kind: 'unique', columns: ['tag.name'] })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('classifies PRIMARYKEY and ROWID constraint violations as UNIQUE (no fallback warn)', () => {
    // A PK collision carries:
    //   code = 'SQLITE_CONSTRAINT_PRIMARYKEY'
    //   message = 'SQLITE_CONSTRAINT_PRIMARYKEY: UNIQUE constraint failed: t.id'
    // The extended codes differ from SQLITE_CONSTRAINT_UNIQUE but the
    // semantic is identical, and SQLite still prefixes the message with
    // "UNIQUE constraint failed: ...".
    const pk = makeSqliteError(
      'SQLITE_CONSTRAINT_PRIMARYKEY',
      'SQLITE_CONSTRAINT_PRIMARYKEY: UNIQUE constraint failed: t.id'
    )
    expect(classifySqliteError(pk)).toEqual({ kind: 'unique', columns: ['t.id'] })

    const rowid = makeSqliteError('SQLITE_CONSTRAINT_ROWID', 'UNIQUE constraint failed: rowid')
    expect(classifySqliteError(rowid)).toEqual({ kind: 'unique', columns: ['rowid'] })

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('classifies FOREIGN KEY', () => {
    const e = makeSqliteError('SQLITE_CONSTRAINT_FOREIGNKEY', 'FOREIGN KEY constraint failed')
    expect(classifySqliteError(e)).toEqual({ kind: 'foreign_key' })
  })

  it('classifies NOT NULL with column list', () => {
    const e = makeSqliteError('SQLITE_CONSTRAINT_NOTNULL', 'NOT NULL constraint failed: tag.name')
    expect(classifySqliteError(e)).toEqual({ kind: 'not_null', columns: ['tag.name'] })
  })

  it('classifies CHECK with constraint name', () => {
    const e = makeSqliteError('SQLITE_CONSTRAINT_CHECK', 'CHECK constraint failed: status_enum')
    expect(classifySqliteError(e)).toEqual({ kind: 'check', constraintName: 'status_enum' })
  })

  it('classifies CHECK with no constraint name', () => {
    const e = makeSqliteError('SQLITE_CONSTRAINT_CHECK', 'CHECK constraint failed')
    expect(classifySqliteError(e)).toEqual({ kind: 'check', constraintName: undefined })
  })

  it('walks through a Drizzle-style cause wrapper', () => {
    const inner = makeSqliteError('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed: tag.name')
    const wrapped = wrapInDrizzleError(inner)
    expect(classifySqliteError(wrapped)).toEqual({ kind: 'unique', columns: ['tag.name'] })
  })

  it('walks up to MAX_CAUSE_DEPTH levels', () => {
    // Depth 5 is the inner error — should be reached
    const inner = makeSqliteError('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed: t.x')
    let chain: Error = inner
    for (let i = 0; i < 4; i++) {
      const outer = new Error(`wrap ${i}`)
      ;(outer as Error & { cause: unknown }).cause = chain
      chain = outer
    }
    expect(classifySqliteError(chain)).toEqual({ kind: 'unique', columns: ['t.x'] })
  })

  it('returns null when chain exceeds MAX_CAUSE_DEPTH before reaching the SQLite error', () => {
    const inner = makeSqliteError('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed: t.x')
    let chain: Error = inner
    // 6 wrappers puts the SqliteError at depth 6, beyond the 5-level walker
    for (let i = 0; i < 6; i++) {
      const outer = new Error(`wrap ${i}`)
      ;(outer as Error & { cause: unknown }).cause = chain
      chain = outer
    }
    expect(classifySqliteError(chain)).toBeNull()
  })

  it('falls back to message match when code is missing, and logs a warning', () => {
    const e = new Error('UNIQUE constraint failed: foo')
    expect(classifySqliteError(e)).toEqual({ kind: 'unique', columns: ['foo'] })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fell back to message match'), expect.any(Object))
  })

  it('returns null for non-constraint errors', () => {
    expect(classifySqliteError(new Error('connection lost'))).toBeNull()
    expect(classifySqliteError(new TypeError('foo is not a function'))).toBeNull()
  })

  it('returns null for non-Error values', () => {
    expect(classifySqliteError(null)).toBeNull()
    expect(classifySqliteError('just a string')).toBeNull()
    expect(classifySqliteError(42)).toBeNull()
    expect(classifySqliteError(undefined)).toBeNull()
  })

  it('returns columns=[] when UNIQUE code is set but message is unparseable', () => {
    const e = makeSqliteError('SQLITE_CONSTRAINT_UNIQUE', 'constraint violated')
    expect(classifySqliteError(e)).toEqual({ kind: 'unique', columns: [] })
  })

  it('parses composite UNIQUE with multiple columns', () => {
    const e = makeSqliteError('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed: user.email, user.tenant_id')
    expect(classifySqliteError(e)).toEqual({
      kind: 'unique',
      columns: ['user.email', 'user.tenant_id']
    })
  })
})

describe('withSqliteErrors', () => {
  it('returns the operation result on success', () => {
    expect(withSqliteErrors(() => 42, {})).toBe(42)
  })

  it('throws the handler result when a matching constraint is raised', () => {
    const uniq = makeSqliteError('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed: t.x')

    expect(
      captureThrow(() =>
        withSqliteErrors(
          () => {
            throw uniq
          },
          {
            unique: () => DataApiErrorFactory.conflict('boom', 'T')
          }
        )
      )
    ).toMatchObject({ code: ErrorCode.CONFLICT, message: 'boom' })
  })

  it('rethrows the original error unchanged when the constraint type has no handler', () => {
    const fkErr = makeSqliteError('SQLITE_CONSTRAINT_FOREIGNKEY', 'FOREIGN KEY constraint failed')

    expect(
      captureThrow(() =>
        withSqliteErrors(
          () => {
            throw fkErr
          },
          {
            unique: () => DataApiErrorFactory.conflict('x', 'T')
          }
        )
      )
    ).toBe(fkErr)
  })

  it('rethrows non-SQLite errors unchanged', () => {
    const net = new Error('EHOSTUNREACH')

    expect(
      captureThrow(() =>
        withSqliteErrors(
          () => {
            throw net
          },
          {
            unique: () => DataApiErrorFactory.conflict('x', 'T')
          }
        )
      )
    ).toBe(net)
  })

  it('passes the parsed columns array to the unique handler', () => {
    const uniq = makeSqliteError('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed: user.email, user.tenant_id')
    let received: string[] | undefined

    captureThrow(() =>
      withSqliteErrors(
        () => {
          throw uniq
        },
        {
          unique: (cols) => {
            received = cols
            return DataApiErrorFactory.conflict('x', 'User')
          }
        }
      )
    )

    expect(received).toEqual(['user.email', 'user.tenant_id'])
  })

  it('passes the constraintName to the check handler', () => {
    const chk = makeSqliteError('SQLITE_CONSTRAINT_CHECK', 'CHECK constraint failed: status_enum')
    let received: string | undefined = 'sentinel'

    captureThrow(() =>
      withSqliteErrors(
        () => {
          throw chk
        },
        {
          check: (name) => {
            received = name
            return DataApiErrorFactory.validation({ _root: ['x'] }, 'x')
          }
        }
      )
    )

    expect(received).toBe('status_enum')
  })

  it('the satisfies pattern compiles and preserves the inferred handler type', () => {
    // This test's primary job is to keep `satisfies SqliteErrorHandlers` in
    // the repo — if a future refactor breaks the types, this file fails to
    // typecheck. The negative case (misspelled keys get rejected) is
    // enforced by the TS compiler at lint time, not here.
    const valid = {
      unique: () => DataApiErrorFactory.conflict('x', 'T')
    } satisfies SqliteErrorHandlers

    expect(valid.unique()).toBeInstanceOf(DataApiError)
  })
})

describe('defaultHandlersFor', () => {
  it('maps UNIQUE to a CONFLICT DataApiError with a templated message', () => {
    const uniq = makeSqliteError('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed: tag.name')

    expect(
      captureThrow(() =>
        withSqliteErrors(
          () => {
            throw uniq
          },
          defaultHandlersFor('Tag', 'my-tag')
        )
      )
    ).toMatchObject({
      code: ErrorCode.CONFLICT,
      message: "Tag 'my-tag' already exists"
    })
  })

  it('maps FOREIGN KEY to NOT_FOUND by default (insert semantics)', () => {
    const fkErr = makeSqliteError('SQLITE_CONSTRAINT_FOREIGNKEY', 'FOREIGN KEY constraint failed')

    expect(
      captureThrow(() =>
        withSqliteErrors(
          () => {
            throw fkErr
          },
          defaultHandlersFor('Tag', 'abc')
        )
      )
    ).toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('maps CHECK to VALIDATION_ERROR with the constraint name when present', () => {
    const chk = makeSqliteError('SQLITE_CONSTRAINT_CHECK', 'CHECK constraint failed: status_enum')

    expect(
      captureThrow(() =>
        withSqliteErrors(
          () => {
            throw chk
          },
          defaultHandlersFor('Tag', 'my-tag')
        )
      )
    ).toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      message: expect.stringContaining('status_enum')
    })
  })

  it('maps NOT NULL to VALIDATION_ERROR with field-level errors per column', () => {
    const notNull = makeSqliteError('SQLITE_CONSTRAINT_NOTNULL', 'NOT NULL constraint failed: tag.color')

    try {
      withSqliteErrors(
        () => {
          throw notNull
        },
        defaultHandlersFor('Tag', 'my-tag')
      )
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(DataApiError)
      const err = e as DataApiError
      expect(err.code).toBe(ErrorCode.VALIDATION_ERROR)
      expect(err.details).toMatchObject({
        fieldErrors: { 'tag.color': ['is required'] }
      })
    }
  })

  it('spread override: the overridden key wins, others retain defaults', () => {
    const fkErr = makeSqliteError('SQLITE_CONSTRAINT_FOREIGNKEY', 'FOREIGN KEY constraint failed')

    expect(
      captureThrow(() =>
        withSqliteErrors(
          () => {
            throw fkErr
          },
          {
            ...defaultHandlersFor('Tag', 'abc'),
            foreignKey: () => DataApiErrorFactory.invalidOperation("Cannot delete Tag 'abc': still referenced")
          } satisfies SqliteErrorHandlers
        )
      )
    ).toMatchObject({
      code: ErrorCode.INVALID_OPERATION
    })

    // Non-overridden keys retain defaults
    const uniq = makeSqliteError('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed: tag.name')
    expect(
      captureThrow(() =>
        withSqliteErrors(
          () => {
            throw uniq
          },
          {
            ...defaultHandlersFor('Tag', 'my-tag'),
            foreignKey: () => DataApiErrorFactory.invalidOperation('x')
          } satisfies SqliteErrorHandlers
        )
      )
    ).toMatchObject({
      code: ErrorCode.CONFLICT,
      message: "Tag 'my-tag' already exists"
    })
  })
})
