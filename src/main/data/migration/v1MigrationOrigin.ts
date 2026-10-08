type MigrationOriginReader = () => boolean

let readMigrationOrigin: MigrationOriginReader = () => false

export function isMigratedFromV1(): boolean {
  return readMigrationOrigin()
}

/** Registered by MigrationEngine when its singleton is initialized. */
export function registerMigrationOriginReader(reader: MigrationOriginReader): void {
  readMigrationOrigin = reader
}
