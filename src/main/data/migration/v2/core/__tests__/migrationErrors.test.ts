import { describe, expect, it } from 'vitest'

import {
  describeErrorChain,
  isMigrationStorageError,
  isSchemaOutOfSyncError,
  MigrationDatabaseError
} from '../migrationErrors'

/**
 * Build an Error carrying an optional SQLite `code` and `.cause`, mirroring how
 * drizzle wraps the real better-sqlite3 SqliteError inside an outer
 * DrizzleQueryError.
 */
function makeError(message: string, opts: { code?: string; cause?: unknown } = {}): Error {
  const error = new Error(message) as Error & { code?: string; cause?: unknown }
  if (opts.code !== undefined) error.code = opts.code
  if (opts.cause !== undefined) error.cause = opts.cause
  return error
}

describe('isSchemaOutOfSyncError', () => {
  it('matches the wrapped DrizzleQueryError → SqliteError shape from a stale DB', () => {
    // Mirrors the real failure: outer DrizzleQueryError wraps an inner SqliteError,
    // both tagged SQLITE_ERROR. (See the report in the issue.)
    const inner = makeError('table `agent` already exists', { code: 'SQLITE_ERROR' })
    const outer = makeError('SQLITE_ERROR: table `agent` already exists', { code: 'SQLITE_ERROR', cause: inner })
    expect(isSchemaOutOfSyncError(outer)).toBe(true)
  })

  it('matches when only the top-level error carries the signal', () => {
    expect(isSchemaOutOfSyncError(makeError("table 'agent' already exists", { code: 'SQLITE_ERROR' }))).toBe(true)
  })

  it('matches index and trigger "already exists" failures', () => {
    expect(isSchemaOutOfSyncError(makeError('index `idx_agent` already exists', { code: 'SQLITE_ERROR' }))).toBe(true)
    expect(isSchemaOutOfSyncError(makeError('trigger `t_agent` already exists', { code: 'SQLITE_ERROR' }))).toBe(true)
  })

  it('is case-insensitive on the message', () => {
    expect(isSchemaOutOfSyncError(makeError('TABLE `agent` ALREADY EXISTS', { code: 'SQLITE_ERROR' }))).toBe(true)
  })

  it('does NOT match constraint violations (different code, no "already exists")', () => {
    const unique = makeError('UNIQUE constraint failed: agent.id', { code: 'SQLITE_CONSTRAINT_UNIQUE' })
    expect(isSchemaOutOfSyncError(unique)).toBe(false)
  })

  it('does NOT match a SQLITE_ERROR with an unrelated message', () => {
    expect(isSchemaOutOfSyncError(makeError('no such table: agent', { code: 'SQLITE_ERROR' }))).toBe(false)
  })

  it('does NOT match an "already exists" message without the SQLITE_ERROR code', () => {
    expect(isSchemaOutOfSyncError(makeError('table `agent` already exists'))).toBe(false)
  })

  it('does NOT match plain errors or non-Error values', () => {
    expect(isSchemaOutOfSyncError(makeError('boom'))).toBe(false)
    expect(isSchemaOutOfSyncError('table `agent` already exists')).toBe(false)
    expect(isSchemaOutOfSyncError(null)).toBe(false)
    expect(isSchemaOutOfSyncError(undefined)).toBe(false)
    expect(isSchemaOutOfSyncError(42)).toBe(false)
  })

  it('stops at the cause-chain depth limit and does not match a deeper signal', () => {
    // 5 non-matching wrappers around 1 matching error → the match sits at
    // depth 5, beyond the 0..4 window the walker inspects.
    let chain: Error = makeError('table `agent` already exists', { code: 'SQLITE_ERROR' })
    for (let i = 0; i < 5; i++) {
      chain = makeError('wrapper', { code: 'SQLITE_ERROR', cause: chain })
    }
    expect(isSchemaOutOfSyncError(chain)).toBe(false)
  })
})

describe('isMigrationStorageError', () => {
  it.each([
    'SQLITE_IOERR',
    'SQLITE_IOERR_READ',
    'SQLITE_READONLY',
    'SQLITE_READONLY_DBMOVED',
    'SQLITE_CANTOPEN',
    'SQLITE_CANTOPEN_NOTEMPDIR',
    'SQLITE_CANTOPEN_ISDIR',
    'SQLITE_CANTOPEN_FULLPATH',
    'SQLITE_CANTOPEN_CONVPATH',
    'SQLITE_CANTOPEN_DIRTYWAL',
    'SQLITE_CANTOPEN_SYMLINK',
    'SQLITE_FULL',
    'SQLITE_PERM',
    'EIO',
    'EACCES',
    'EPERM',
    'EROFS',
    'ENOSPC'
  ])('matches %s through a nested cause chain', (code) => {
    const storageCause = makeError('storage unavailable', { code })
    const wrapped = new MigrationDatabaseError('schema', makeError('query failed', { cause: storageCause }))

    expect(isMigrationStorageError(wrapped)).toBe(true)
  })

  it('matches a code-less database-open failure from its stage context', () => {
    expect(isMigrationStorageError(new MigrationDatabaseError('open', new Error('unable to open database file')))).toBe(
      true
    )
  })

  it.each(['SQLITE_NOTADB', 'SQLITE_CORRUPT'])(
    'does not classify an open-stage %s failure as unavailable storage',
    (code) => {
      const corruption = makeError('database file is invalid', { code })

      expect(isMigrationStorageError(new MigrationDatabaseError('open', corruption))).toBe(false)
    }
  )

  it('does not classify an ordinary schema incompatibility as a storage failure', () => {
    const schemaError = makeError('table `agent` already exists', { code: 'SQLITE_ERROR' })

    expect(isMigrationStorageError(new MigrationDatabaseError('schema', schemaError))).toBe(false)
  })

  it('does not classify a code-less WAL or schema failure as a storage failure', () => {
    expect(isMigrationStorageError(new MigrationDatabaseError('wal', new Error('unexpected failure')))).toBe(false)
    expect(isMigrationStorageError(new MigrationDatabaseError('schema', new Error('unexpected failure')))).toBe(false)
  })
})

describe('MigrationDatabaseError', () => {
  it.each([
    ['open', 'Failed to open migration database'],
    ['wal', 'Failed to configure migration database WAL'],
    ['schema', 'Database schema migration failed']
  ] as const)('preserves %s stage context without duplicating the driver reason', (stage, stageMessage) => {
    const driverMessage = 'database or disk is full'
    const driver = makeError(driverMessage, { code: 'SQLITE_FULL' })

    const described = describeErrorChain(new MigrationDatabaseError(stage, driver))

    expect(described).toBe(`${stageMessage}\ncaused by: [SQLITE_FULL] ${driverMessage}`)
    expect(described.match(new RegExp(driverMessage, 'g'))).toHaveLength(1)
  })
})

describe('describeErrorChain', () => {
  it('surfaces the driver reason and code that DrizzleQueryError.message omits', () => {
    // The real shape behind "Migration Failed": drizzle names the statement, the
    // wrapped SqliteError is the only thing that says why it could not run.
    const driver = makeError('database or disk is full', { code: 'SQLITE_FULL' })
    const drizzle = makeError(
      'Failed query: CREATE INDEX `agent_session_message_created_at_id_idx` ON `agent_session_message`\nparams: ',
      { cause: driver }
    )

    const described = describeErrorChain(drizzle)

    expect(described).toContain('SQLITE_FULL')
    expect(described).toContain('database or disk is full')
  })

  it('keeps every link of a multi-level chain', () => {
    const driver = makeError('database is locked', { code: 'SQLITE_BUSY' })
    const drizzle = makeError('Failed query: CREATE INDEX ...', { cause: driver })
    const wrapper = new Error('Database schema migration failed', { cause: drizzle })

    const described = describeErrorChain(wrapper)

    expect(described).toContain('Database schema migration failed')
    expect(described).toContain('Failed query: CREATE INDEX ...')
    expect(described).toContain('[SQLITE_BUSY] database is locked')
  })

  it('falls back to the value itself when it is not an Error', () => {
    expect(describeErrorChain('boom')).toBe('boom')
  })

  it('terminates on a cyclic cause chain', () => {
    const a = makeError('a')
    const b = makeError('b', { cause: a })
    a.cause = b

    expect(describeErrorChain(a).split('caused by:')).toHaveLength(5)
  })
})
