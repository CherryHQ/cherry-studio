import { describe, expect, it } from 'vitest'

import { isSchemaOutOfSyncError } from '../migrationErrors'

/**
 * Build an Error carrying an optional libsql-style `code` and `.cause`,
 * mirroring how drizzle/libsql wrap the real SqliteError inside a
 * LibsqlError.
 */
function makeError(message: string, opts: { code?: string; cause?: unknown } = {}): Error {
  const error = new Error(message) as Error & { code?: string; cause?: unknown }
  if (opts.code !== undefined) error.code = opts.code
  if (opts.cause !== undefined) error.cause = opts.cause
  return error
}

describe('isSchemaOutOfSyncError', () => {
  it('matches the wrapped LibsqlError → SqliteError shape from a stale DB', () => {
    // Mirrors the real failure: outer LibsqlError wraps an inner SqliteError,
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
