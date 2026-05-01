import { loggerService } from '@logger'
import { DataApiError, DataApiErrorFactory, ErrorCode } from '@shared/data/api'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

import { classifySqliteError, defaultHandlersFor, type SqliteErrorHandlers, withSqliteErrors } from '../sqliteErrors'

/**
 * Build a synthetic error that mimics a raw libsql SqliteError:
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
    // Observed in real libsql output when a PK collides:
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
  it('returns the operation result on success', async () => {
    await expect(withSqliteErrors(async () => 42, {})).resolves.toBe(42)
  })

  it('throws the handler result when a matching constraint is raised', async () => {
    const uniq = makeSqliteError('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed: t.x')

    await expect(
      withSqliteErrors(
        async () => {
          throw uniq
        },
        {
          unique: () => DataApiErrorFactory.conflict('boom', 'T')
        }
      )
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT, message: 'boom' })
  })

  it('rethrows the original error unchanged when the constraint type has no handler', async () => {
    const fkErr = makeSqliteError('SQLITE_CONSTRAINT_FOREIGNKEY', 'FOREIGN KEY constraint failed')

    await expect(
      withSqliteErrors(
        async () => {
          throw fkErr
        },
        {
          unique: () => DataApiErrorFactory.conflict('x', 'T')
        }
      )
    ).rejects.toBe(fkErr)
  })

  it('rethrows non-SQLite errors unchanged', async () => {
    const net = new Error('EHOSTUNREACH')

    await expect(
      withSqliteErrors(
        async () => {
          throw net
        },
        {
          unique: () => DataApiErrorFactory.conflict('x', 'T')
        }
      )
    ).rejects.toBe(net)
  })

  it('passes the parsed columns array to the unique handler', async () => {
    const uniq = makeSqliteError('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed: user.email, user.tenant_id')
    let received: string[] | undefined

    await withSqliteErrors(
      async () => {
        throw uniq
      },
      {
        unique: (cols) => {
          received = cols
          return DataApiErrorFactory.conflict('x', 'User')
        }
      }
    ).catch(() => {})

    expect(received).toEqual(['user.email', 'user.tenant_id'])
  })

  it('passes the constraintName to the check handler', async () => {
    const chk = makeSqliteError('SQLITE_CONSTRAINT_CHECK', 'CHECK constraint failed: status_enum')
    let received: string | undefined = 'sentinel'

    await withSqliteErrors(
      async () => {
        throw chk
      },
      {
        check: (name) => {
          received = name
          return DataApiErrorFactory.validation({ _root: ['x'] }, 'x')
        }
      }
    ).catch(() => {})

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
  it('maps UNIQUE to a CONFLICT DataApiError with a templated message', async () => {
    const uniq = makeSqliteError('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed: tag.name')

    await expect(
      withSqliteErrors(
        async () => {
          throw uniq
        },
        defaultHandlersFor('Tag', 'my-tag')
      )
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      message: "Tag 'my-tag' already exists"
    })
  })

  it('maps FOREIGN KEY to NOT_FOUND by default (insert semantics)', async () => {
    const fkErr = makeSqliteError('SQLITE_CONSTRAINT_FOREIGNKEY', 'FOREIGN KEY constraint failed')

    await expect(
      withSqliteErrors(
        async () => {
          throw fkErr
        },
        defaultHandlersFor('Tag', 'abc')
      )
    ).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('maps CHECK to VALIDATION_ERROR with the constraint name when present', async () => {
    const chk = makeSqliteError('SQLITE_CONSTRAINT_CHECK', 'CHECK constraint failed: status_enum')

    await expect(
      withSqliteErrors(
        async () => {
          throw chk
        },
        defaultHandlersFor('Tag', 'my-tag')
      )
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      message: expect.stringContaining('status_enum')
    })
  })

  it('maps NOT NULL to VALIDATION_ERROR with field-level errors per column', async () => {
    const notNull = makeSqliteError('SQLITE_CONSTRAINT_NOTNULL', 'NOT NULL constraint failed: tag.color')

    try {
      await withSqliteErrors(
        async () => {
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

  it('spread override: the overridden key wins, others retain defaults', async () => {
    const fkErr = makeSqliteError('SQLITE_CONSTRAINT_FOREIGNKEY', 'FOREIGN KEY constraint failed')

    await expect(
      withSqliteErrors(
        async () => {
          throw fkErr
        },
        {
          ...defaultHandlersFor('Tag', 'abc'),
          foreignKey: () => DataApiErrorFactory.invalidOperation("Cannot delete Tag 'abc': still referenced")
        } satisfies SqliteErrorHandlers
      )
    ).rejects.toMatchObject({
      code: ErrorCode.INVALID_OPERATION
    })

    // Non-overridden keys retain defaults
    const uniq = makeSqliteError('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed: tag.name')
    await expect(
      withSqliteErrors(
        async () => {
          throw uniq
        },
        {
          ...defaultHandlersFor('Tag', 'my-tag'),
          foreignKey: () => DataApiErrorFactory.invalidOperation('x')
        } satisfies SqliteErrorHandlers
      )
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      message: "Tag 'my-tag' already exists"
    })
  })
})
