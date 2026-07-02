// Backup neutral layer — write/read DB wrappers (Track A1b).
//
// BackupScopedDb / BackupReadonlyDb wrap a drizzle DbOrTx and narrow what a
// contributor hook may do: BackupScopedDb enforces an allowedTables write boundary
// (a contributor can only write its own declared tables — fail-loud otherwise),
// while reads stay unrestricted (cross-domain ref-target verification). Hook
// context interfaces live in contributor-types.ts (co-located with the operations
// that consume them) so this module has no type edge back into contributor-types.

import type { DbOrTx } from '@main/data/db/types'
import { getTableName, type Table } from 'drizzle-orm'

import type { DbTableName } from './dbSchemaRefs'

/** Resolve a drizzle table object to its branded DbTableName (codegen-validated literal). */
const tableNameOf = (table: Table): DbTableName => getTableName(table) as DbTableName

/**
 * Thrown when a contributor tries to write a table outside its declared
 * schema.tables via BackupScopedDb. The boundary keeps "a contributor only writes
 * its own domain" a fail-loud invariant rather than a convention.
 */
export class ContributorWriteBoundaryViolationError extends Error {
  readonly tableName: string
  readonly allowedTables: readonly string[]
  constructor(table: Table, allowedTables: ReadonlySet<DbTableName>) {
    const name = tableNameOf(table)
    const allowed = [...allowedTables].sort()
    super(`contributor write boundary violation: table '${name}' is not in allowedTables [${allowed.join(', ')}]`)
    this.name = 'ContributorWriteBoundaryViolationError'
    this.tableName = name
    this.allowedTables = allowed
  }
}

/**
 * Write-scoped drizzle wrapper. `select` is unrestricted (cross-domain reads for
 * ref-target verification); `insert`/`update`/`delete` guard the target table
 * against `allowedTables` (= the contributor's schema.tables) and throw on a
 * cross-domain write. Transactions/PRAGMAs are owned by the orchestrator and are
 * NOT exposed (no `transaction`/`run`/`all`). Methods (not arrow fields) so they
 * share `this` with the instance and avoid class-field init-ordering issues.
 */
export class BackupScopedDb {
  constructor(
    private readonly tx: DbOrTx,
    private readonly allowedTables: ReadonlySet<DbTableName>
  ) {}

  /** Reads are unrestricted — cross-domain ref-target verification needs them. */
  select() {
    return this.tx.select()
  }

  insert<T extends Table>(table: T) {
    if (!this.allowedTables.has(tableNameOf(table))) {
      throw new ContributorWriteBoundaryViolationError(table, this.allowedTables)
    }
    // Return the inferred drizzle builder so .values({...}) column-checks against `table`.
    return this.tx.insert(table)
  }

  update<T extends Table>(table: T) {
    if (!this.allowedTables.has(tableNameOf(table))) {
      throw new ContributorWriteBoundaryViolationError(table, this.allowedTables)
    }
    return this.tx.update(table)
  }

  delete<T extends Table>(table: T) {
    if (!this.allowedTables.has(tableNameOf(table))) {
      throw new ContributorWriteBoundaryViolationError(table, this.allowedTables)
    }
    return this.tx.delete(table)
  }
}

/** Read-only drizzle wrapper — `select` only. For hooks that only read live/backup DB. */
export class BackupReadonlyDb {
  constructor(private readonly tx: DbOrTx) {}

  select() {
    return this.tx.select()
  }
}
