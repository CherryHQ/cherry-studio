import { describe, expect, it } from 'vitest'

import { migrationDatabaseDiagnosticResultSchema, MigrationDatabaseDiagnostics } from '../index'

describe('migration database diagnostics barrel', () => {
  it('can be imported on the main thread without executing the worker module', () => {
    expect(MigrationDatabaseDiagnostics).toBeTypeOf('function')
    expect(migrationDatabaseDiagnosticResultSchema).toBeDefined()
  })
})
