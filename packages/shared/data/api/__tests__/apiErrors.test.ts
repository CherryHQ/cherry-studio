import { DataApiErrorFactory, ErrorCode } from '@shared/data/api'
import { describe, expect, it } from 'vitest'

function createWrappedSqliteError(message: string, code: string) {
  const rootCause = Object.assign(new Error(message), { code })
  return Object.assign(new Error('Failed query: insert into ...'), { cause: rootCause })
}

describe('DataApiErrorFactory.translateSqliteError', () => {
  it('should translate wrapped unique constraint errors using mapped column messages', () => {
    const error = createWrappedSqliteError('UNIQUE constraint failed: tag.name', 'SQLITE_CONSTRAINT_UNIQUE')

    const translated = DataApiErrorFactory.translateSqliteError(error, {
      entity: 'Tag',
      uniqueConstraintMessages: {
        name: "Tag with name 'work' already exists"
      },
      genericConflictMessage: 'Tag conflicts with existing data'
    })

    expect(translated).toMatchObject({
      code: ErrorCode.CONFLICT,
      message: "Tag with name 'work' already exists"
    })
  })

  it('should fall back to a generic conflict message when the unique column is unmapped', () => {
    const error = createWrappedSqliteError(
      'UNIQUE constraint failed: tag.some_future_column',
      'SQLITE_CONSTRAINT_UNIQUE'
    )

    const translated = DataApiErrorFactory.translateSqliteError(error, {
      entity: 'Tag',
      uniqueConstraintMessages: {
        name: "Tag with name 'work' already exists"
      },
      genericConflictMessage: 'Tag conflicts with existing data'
    })

    expect(translated).toMatchObject({
      code: ErrorCode.CONFLICT,
      message: 'Tag conflicts with existing data'
    })
  })

  it('should translate foreign key constraint errors into NOT_FOUND when configured', () => {
    const error = createWrappedSqliteError('FOREIGN KEY constraint failed', 'SQLITE_CONSTRAINT_FOREIGNKEY')

    const translated = DataApiErrorFactory.translateSqliteError(error, {
      entity: 'Tag',
      foreignKeyNotFound: {
        resource: 'Tag',
        id: 'missing-tag'
      }
    })

    expect(translated).toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: "Tag with id 'missing-tag' not found"
    })
  })

  it('should return undefined for unrelated errors', () => {
    const translated = DataApiErrorFactory.translateSqliteError(new Error('connection lost'), {
      entity: 'Tag',
      genericConflictMessage: 'Tag conflicts with existing data'
    })

    expect(translated).toBeUndefined()
  })
})
