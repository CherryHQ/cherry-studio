export type MigrationDatabaseProtocolObjectKind = 'table' | 'index' | 'trigger' | 'view'

export interface MigrationDatabaseProtocolObjectDefinition {
  readonly id: string
  readonly name?: string
  readonly kind: MigrationDatabaseProtocolObjectKind
  readonly columnCount?: number
}

export const MIGRATION_DATABASE_DIAGNOSTIC_VERSION: 1
export const MIGRATION_DATABASE_EXPECTED_SCHEMA_VERSION: 1
export const MIGRATION_DATABASE_DIAGNOSTIC_MAX_DATABASE_FILE_LENGTH: 32_768
export const MIGRATION_DATABASE_DIAGNOSTIC_MAX_MESSAGE_BYTES: 65_536
export const MIGRATION_DATABASE_DIAGNOSTIC_MAX_SCHEMA_OBJECTS: 160
export const MIGRATION_DATABASE_DIAGNOSTIC_MAX_SCHEMA_ROWS_SCANNED: 2_048
export const MIGRATION_DATABASE_DIAGNOSTIC_QUICK_CHECK_RESULT_LIMIT: 20
export const MIGRATION_DATABASE_DIAGNOSTIC_MAX_FOREIGN_KEY_ROWS: 256
export const MIGRATION_DATABASE_DIAGNOSTIC_MAX_FOREIGN_KEY_GROUPS: 64
export const EXPECTED_MIGRATION_DATABASE_OBJECTS: readonly MigrationDatabaseProtocolObjectDefinition[]
