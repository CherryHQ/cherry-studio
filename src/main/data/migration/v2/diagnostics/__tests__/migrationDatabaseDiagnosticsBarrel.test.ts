import { describe, expect, it } from 'vitest'

import {
  migrationDatabaseDiagnosticResultSchema,
  MigrationDatabaseDiagnostics,
  MigrationDiagnosticBundleBuilder,
  migrationDiagnosticManifestSchema
} from '../index'

describe('migration database diagnostics barrel', () => {
  it('can be imported on the main thread without starting the isolated child', () => {
    expect(MigrationDatabaseDiagnostics).toBeTypeOf('function')
    expect(migrationDatabaseDiagnosticResultSchema).toBeDefined()
    expect(MigrationDiagnosticBundleBuilder).toBeTypeOf('function')
    expect(migrationDiagnosticManifestSchema).toBeDefined()
  })
})
