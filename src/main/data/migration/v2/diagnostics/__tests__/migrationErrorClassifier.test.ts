import { createUniqueModelId } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { classifyMigrationPrebootFailure } from '../../migrationDiagnostics'
import { classifyMigrationError } from '../migrationErrorClassifier'

function errorWithCode(code: string, cause?: unknown): Error {
  return Object.assign(new Error('private error text', { cause }), { code })
}

describe('classifyMigrationError', () => {
  it.each([
    ['SQLITE_CANTOPEN', 'sqlite_open_failed'],
    ['SQLITE_CANTOPEN_ISDIR', 'sqlite_open_failed'],
    ['SQLITE_CORRUPT', 'sqlite_corrupt'],
    ['SQLITE_NOTADB', 'sqlite_not_database'],
    ['SQLITE_SCHEMA', 'sqlite_schema'],
    ['SQLITE_CONSTRAINT', 'sqlite_constraint'],
    ['SQLITE_CONSTRAINT_UNIQUE', 'sqlite_constraint'],
    ['SQLITE_READONLY', 'sqlite_readonly'],
    ['SQLITE_READONLY_DBMOVED', 'sqlite_readonly'],
    ['SQLITE_PERM', 'sqlite_permission'],
    ['SQLITE_TOOBIG', 'sqlite_too_big'],
    ['SQLITE_BUSY', 'sqlite_busy'],
    ['SQLITE_BUSY_TIMEOUT', 'sqlite_busy'],
    ['SQLITE_LOCKED', 'sqlite_locked'],
    ['SQLITE_LOCKED_SHAREDCACHE', 'sqlite_locked'],
    ['SQLITE_IOERR', 'sqlite_io'],
    ['SQLITE_IOERR_READ', 'sqlite_io'],
    ['SQLITE_FULL', 'sqlite_io'],
    ['ENOENT', 'file_missing'],
    ['ENOTDIR', 'file_invalid_type'],
    ['EEXIST', 'file_invalid_type'],
    ['EACCES', 'file_permission'],
    ['EPERM', 'file_permission'],
    ['EROFS', 'file_readonly'],
    ['EIO', 'file_io'],
    ['ENOSPC', 'file_io']
  ] as const)('classifies %s', (code, errorCode) => {
    expect(classifyMigrationError(errorWithCode(code))).toEqual({ errorCode })
  })

  it('returns the first recognized code in a bounded cause chain', () => {
    const nested = errorWithCode('SQLITE_TOOBIG')
    const error = errorWithCode('UNRECOGNIZED', new Error('wrapper', { cause: nested }))

    expect(classifyMigrationError(error)).toEqual({ errorCode: 'sqlite_too_big' })
  })

  it('copies only the fixed role and rule from a typed unique-model-id violation', () => {
    let error: unknown
    try {
      createUniqueModelId('provider', 'PRIVATE_MODEL_ID?')
    } catch (caught) {
      error = caught
    }

    const result = classifyMigrationError(new Error('PRIVATE_WRAPPER', { cause: error }))

    expect(result).toEqual({
      errorCode: 'source_invalid_identifier',
      identifierViolation: {
        identifierRole: 'model_id',
        rule: 'contains_reserved_route_character'
      }
    })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_')
  })

  it.each([
    ['MIGRATION_FOREIGN_KEY', 'validation_foreign_key'],
    ['MIGRATION_COUNT_MISMATCH', 'validation_count_mismatch'],
    ['MIGRATION_VALIDATION_FAILED', 'validation_status'],
    ['MIGRATION_REQUIRED_RECORDS_REJECTED', 'source_required_records_rejected']
  ] as const)('classifies fixed migration code %s', (code, errorCode) => {
    expect(classifyMigrationError(errorWithCode(code))).toEqual({ errorCode })
  })

  it('inspects depths 0 through 4 but not depth 5', () => {
    let atDepthFour: Error = errorWithCode('SQLITE_CORRUPT')
    for (let index = 0; index < 4; index++) atDepthFour = new Error('wrapper', { cause: atDepthFour })
    expect(classifyMigrationError(atDepthFour)).toEqual({ errorCode: 'sqlite_corrupt' })

    const atDepthFive = new Error('wrapper', { cause: atDepthFour })
    expect(classifyMigrationError(atDepthFive)).toEqual({ errorCode: 'unknown_error' })
  })

  it('terminates cyclic causes', () => {
    const first = new Error('first')
    const second = new Error('second', { cause: first })
    Object.defineProperty(first, 'cause', { value: second })

    expect(classifyMigrationError(first)).toEqual({ errorCode: 'unknown_error' })
  })

  it('does not execute accessors or stringify unknown values', () => {
    let getterCalls = 0
    const hostile = {
      get cause() {
        getterCalls += 1
        throw new Error('cause getter executed')
      },
      get code() {
        getterCalls += 1
        throw new Error('code getter executed')
      },
      get name() {
        getterCalls += 1
        throw new Error('name getter executed')
      },
      toString() {
        throw new Error('toString executed')
      },
      [Symbol.toPrimitive]() {
        throw new Error('conversion executed')
      }
    }

    expect(classifyMigrationError(hostile)).toEqual({ errorCode: 'unknown_error' })
    expect(getterCalls).toBe(0)
  })

  it('does not expose the raw message, stack, code, or cause depth', () => {
    const result = classifyMigrationError(errorWithCode('SQLITE_CORRUPT'))

    expect(Object.keys(result)).toEqual(['errorCode'])
    expect(result).not.toHaveProperty('message')
    expect(result).not.toHaveProperty('stack')
  })
})

describe('classifyMigrationPrebootFailure', () => {
  it('preserves a filesystem type conflict instead of replacing it with the fallback', () => {
    expect(classifyMigrationPrebootFailure(errorWithCode('ENOTDIR'), 'database_initialize_failed')).toBe(
      'file_invalid_type'
    )
  })
})
