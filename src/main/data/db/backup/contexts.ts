// Backup neutral layer — typed hook contexts (Track A1b).
//
// BackupScopedDb / BackupReadonlyDb wrap a drizzle DbOrTx and narrow what a
// contributor hook may do: BackupScopedDb enforces an allowedTables write boundary
// (a contributor can only write its own declared tables — fail-loud otherwise),
// while reads stay unrestricted (cross-domain ref-target verification). The hook
// context interfaces carry tx/paths/registry, constructed and injected by the
// orchestrator (contributors never `new` a context).
//
// Contract: openspec/.../modular-backup-contributor/{contexts,hooks}.md.

import type { LoggerService } from '@logger'
import type { DbOrTx } from '@main/data/db/types'
import { getTableName, type Table } from 'drizzle-orm'

import type { AggregateBoundary, ReadonlyBackupRegistry } from './contributor-types'
import type { DbTableName } from './dbSchemaRefs'
import type { BackupDomain, ConflictStrategy } from './domains'

/** spec writes `Logger` but the codebase only has `LoggerService` (withContext returns it). */
export type Logger = LoggerService

/** Backup lifecycle phase (derived from BackupProgressEmitter.tick's phase union). */
export type BackupPhase = 'collect' | 'archive' | 'restore' | 'verify'

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

/** Progress reporting surface the orchestrator injects (optional on contexts). */
export interface BackupProgressEmitter {
  tick(phase: BackupPhase, count?: number): void
  fail(phase: BackupPhase, error: unknown): void
}

/** Fields every hook context shares. Constructed/injected by the orchestrator. */
export interface BackupContextBase {
  readonly registry: ReadonlyBackupRegistry
  readonly restoreId: string
  readonly domains: readonly BackupDomain[]
  readonly strategy: ConflictStrategy
  /** loggerService.withContext('backup/<domain>') — contributors must not build their own. */
  readonly logger: Logger
  /** Omitted in unit tests; when absent the hook simply does not report progress. */
  readonly progress?: BackupProgressEmitter
}

/** Context for collectFileResources — reads live DB file metadata only. */
export interface FileResourceContext extends BackupContextBase {
  readonly liveDb: BackupReadonlyDb
}

/** Context for beforeArchive — may write the backup copy (own domain only). */
export interface BeforeArchiveContext extends BackupContextBase {
  readonly backupDb: BackupScopedDb
}

/**
 * Context for transformRow — pure computation, NO db on the context. Return null to
 * skip the row. Returned rows are written by the importer (global coordinator), so
 * the allowedTables boundary does not apply here.
 */
export interface RowTransformContext extends BackupContextBase {
  readonly row: Readonly<Record<string, unknown>>
  readonly table: DbTableName
}

/**
 * Context for afterImport. backupDb is write-scoped to the contributor's tables
 * (backup-copy cleanup / redaction); liveDb is read-only (FTS rebuild and cache
 * reload go through business Services, never a direct ctx.liveDb write).
 */
export interface AfterImportContext extends BackupContextBase {
  readonly importedRowCount: number
  readonly backupDb: BackupScopedDb
  readonly liveDb: BackupReadonlyDb
}

/** Return value of restoreResources: which files were restored vs intentionally skipped. */
export interface RestoreResourceResult {
  readonly restoredFileIds: Set<string>
  readonly skippedFileIds: Set<string>
}

/**
 * Context for restoreResources. Paths are pre-resolved strings (the orchestrator
 * centralizes application.getPath); filesAffected is the pre-write planned set
 * (the file-snapshot source) that restoreResources only reads to verify.
 */
export interface RestoreResourceContext extends BackupContextBase {
  readonly backupRoot: string
  readonly liveFileRoot: string
  readonly filesAffected: ReadonlySet<string>
  readonly knowledgeRoot?: string
}

/**
 * Context for cloneAggregate — pure computation, NO db. newRootKey is generated by
 * the importer per PrimaryKeyFact.kind (v4/v7); member row re-keying is done by the
 * importer via memberKeyMap, so cloneAggregate only swaps the root PK.
 */
export interface CloneAggregateContext extends BackupContextBase {
  readonly aggregate: AggregateBoundary
  readonly rootRow: Readonly<Record<string, unknown>>
  /** Importer-generated new root PK (uuid version follows the root's PrimaryKeyFact.kind). */
  readonly newRootKey: string
  /** Old→new PK map per member table; empty for members whose PK derives from the root. */
  readonly memberKeyMap: ReadonlyMap<DbTableName, ReadonlyMap<string, string>>
}
