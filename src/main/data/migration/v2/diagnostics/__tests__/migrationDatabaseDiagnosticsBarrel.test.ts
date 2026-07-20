import { describe, expect, it } from 'vitest'

import * as diagnostics from '../index'
import {
  migrationDatabaseDiagnosticResultSchema,
  MigrationDatabaseDiagnostics,
  migrationDatabaseDiagnosticsChildMessageSchema,
  migrationDatabaseSqliteResultSchema,
  MigrationDiagnosticBundleBuilder,
  migrationDiagnosticManifestSchema
} from '../index'

describe('migration database diagnostics barrel', () => {
  it('can be imported on the main thread without starting the isolated child', () => {
    expect(MigrationDatabaseDiagnostics).toBeTypeOf('function')
    expect(migrationDatabaseDiagnosticResultSchema).toBeDefined()
    expect(migrationDatabaseSqliteResultSchema).toBeDefined()
    expect(migrationDatabaseDiagnosticsChildMessageSchema).toBeDefined()
    expect(MigrationDiagnosticBundleBuilder).toBeTypeOf('function')
    expect(migrationDiagnosticManifestSchema).toBeDefined()
    expect(diagnostics).not.toHaveProperty('createCanonicalMigrationDiagnosticArchive')
    expect(diagnostics).not.toHaveProperty('validateCanonicalZipStructure')
  })
})
