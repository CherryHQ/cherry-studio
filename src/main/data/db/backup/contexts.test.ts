// Tests for the BackupScopedDb allowedTables write boundary and BackupReadonlyDb
// (the runtime parts of contexts.ts). The contributor-types.ts interfaces are pure
// types — their correctness is enforced by tsc, not runtime assertions.
import type { DbOrTx } from '@main/data/db/types'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import { BackupReadonlyDb, BackupScopedDb, ContributorWriteBoundaryViolationError } from './contexts'
import type { DbTableName } from './dbSchemaRefs'

// Two throwaway tables for boundary checks. Their names are what the guard compares
// against the allowedTables set.
const allowedTable = sqliteTable('allowed_tbl', { id: text() })
const forbiddenTable = sqliteTable('forbidden_tbl', { id: text() })

// Minimal DbOrTx stub. The guard only reaches tx.insert/update/delete on ALLOWED
// tables (it throws before the call otherwise), so the stubs just need to exist.
const tx = {
  select: () => ({ from: () => 'rows' }),
  insert: () => ({ values: () => undefined }),
  update: () => ({ set: () => ({ where: () => undefined }) }),
  delete: () => ({ where: () => undefined })
} as unknown as DbOrTx

describe('BackupScopedDb allowedTables guard', () => {
  // 'allowed_tbl' is a fake name not in the real DbTableName union; cast for the test.
  const db = new BackupScopedDb(tx, new Set<DbTableName>(['allowed_tbl' as DbTableName]))

  it('allows insert/update/delete on a declared table', () => {
    expect(() => db.insert(allowedTable)).not.toThrow()
    expect(() => db.update(allowedTable)).not.toThrow()
    expect(() => db.delete(allowedTable)).not.toThrow()
  })

  it('throws ContributorWriteBoundaryViolationError on a cross-domain insert', () => {
    expect(() => db.insert(forbiddenTable)).toThrow(ContributorWriteBoundaryViolationError)
  })

  it('throws on cross-domain update and delete too', () => {
    expect(() => db.update(forbiddenTable)).toThrow(ContributorWriteBoundaryViolationError)
    expect(() => db.delete(forbiddenTable)).toThrow(ContributorWriteBoundaryViolationError)
  })

  it('carries the offending table name and the allowed set on the error', () => {
    try {
      db.insert(forbiddenTable)
      throw new Error('expected ContributorWriteBoundaryViolationError')
    } catch (e) {
      const err = e as ContributorWriteBoundaryViolationError
      expect(err.tableName).toBe('forbidden_tbl')
      expect(err.allowedTables).toEqual(['allowed_tbl'])
    }
  })

  it('does not restrict select (cross-domain reads allowed)', () => {
    expect(() => db.select()).not.toThrow()
  })
})

describe('BackupReadonlyDb', () => {
  it('exposes select only — no insert/update/delete on the instance', () => {
    const ro = new BackupReadonlyDb(tx)
    expect(typeof ro.select).toBe('function')
    const probe = ro as unknown as Record<string, unknown>
    expect(probe.insert).toBeUndefined()
    expect(probe.update).toBeUndefined()
    expect(probe.delete).toBeUndefined()
  })
})
