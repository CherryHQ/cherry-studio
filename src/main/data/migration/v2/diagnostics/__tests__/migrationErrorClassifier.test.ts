import { describe, expect, it } from 'vitest'

import { classifyMigrationError } from '../migrationErrorClassifier'

function errorWithCode(code: string, cause?: unknown): Error {
  return Object.assign(new Error('private error text', { cause }), { code })
}

describe('classifyMigrationError', () => {
  it.each([
    ['EACCES', 'filesystem', 'permission_denied'],
    ['EPERM', 'filesystem', 'permission_denied'],
    ['ENOENT', 'filesystem', 'path_unavailable'],
    ['ENOTDIR', 'filesystem', 'path_unavailable'],
    ['ENOSPC', 'filesystem', 'disk_full'],
    ['SQLITE_CORRUPT', 'database_read', 'sqlite_corrupt'],
    ['SQLITE_NOTADB', 'database_read', 'sqlite_not_database'],
    ['SQLITE_TOOBIG', 'database_write', 'sqlite_too_big'],
    ['SQLITE_CONSTRAINT', 'database_write', 'sqlite_constraint'],
    ['SQLITE_CONSTRAINT_UNIQUE', 'database_write', 'sqlite_constraint'],
    ['SQLITE_SCHEMA', 'database_read', 'sqlite_schema']
  ] as const)('classifies %s', (code, category, expectedCode) => {
    expect(classifyMigrationError(errorWithCode(code))).toEqual({ category, code: expectedCode, causeDepth: 0 })
  })

  it('returns the first recognized code in a bounded cause chain', () => {
    const nested = errorWithCode('SQLITE_TOOBIG')
    const error = errorWithCode('UNRECOGNIZED', new Error('wrapper', { cause: nested }))

    expect(classifyMigrationError(error)).toEqual({
      category: 'database_write',
      code: 'sqlite_too_big',
      causeDepth: 2
    })
  })

  it('inspects depths 0 through 4 but not depth 5', () => {
    let atDepthFour: Error = errorWithCode('SQLITE_CORRUPT')
    for (let index = 0; index < 4; index++) atDepthFour = new Error('wrapper', { cause: atDepthFour })
    expect(classifyMigrationError(atDepthFour)).toEqual({
      category: 'database_read',
      code: 'sqlite_corrupt',
      causeDepth: 4
    })

    const atDepthFive = new Error('wrapper', { cause: atDepthFour })
    expect(classifyMigrationError(atDepthFive)).toEqual({ category: 'unknown', code: 'unknown', causeDepth: 0 })
  })

  it('terminates cyclic causes', () => {
    const first = new Error('first')
    const second = new Error('second', { cause: first })
    Object.defineProperty(first, 'cause', { value: second })

    expect(classifyMigrationError(first)).toEqual({ category: 'unknown', code: 'unknown', causeDepth: 0 })
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

    expect(classifyMigrationError(hostile)).toEqual({ category: 'unknown', code: 'unknown', causeDepth: 0 })
    expect(getterCalls).toBe(0)
  })
})
