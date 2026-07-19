declare const migrationDatabaseDiagnosticsLeaseBrand: unique symbol

interface MigrationDatabaseFileIdentity {
  readonly device: string
  readonly inode: string
}

export interface MigrationDatabaseDiagnosticsLease {
  readonly [migrationDatabaseDiagnosticsLeaseBrand]: true
  readonly databaseFile: string
  readonly identity: {
    readonly database: MigrationDatabaseFileIdentity
    readonly wal: MigrationDatabaseFileIdentity
    readonly shm: MigrationDatabaseFileIdentity
  }
}
