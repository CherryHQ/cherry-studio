import { describe, expect, it } from 'vitest'

import { migrationDiagnosticFailureSchema } from '../migrationDiagnosticsSchemas'

describe('migrationDiagnosticFailureSchema', () => {
  it.each([
    {
      kind: 'upgrade_path_blocked',
      scope: 'gate',
      phase: 'validate',
      errorCode: 'v1_too_old'
    },
    {
      kind: 'preboot_failed',
      scope: 'gate',
      phase: 'initialize',
      errorCode: 'database_initialize_failed'
    },
    {
      kind: 'renderer_export_failed',
      scope: 'renderer_export',
      phase: 'finalize',
      errorCode: 'file_invalid_type'
    },
    {
      kind: 'source_prepare_failed',
      scope: 'migrator',
      phase: 'prepare',
      migratorId: 'mcp_server',
      errorCode: 'source_required_records_rejected'
    },
    {
      kind: 'migration_write_failed',
      scope: 'migrator',
      phase: 'execute',
      migratorId: 'chat',
      errorCode: 'sqlite_constraint'
    },
    {
      kind: 'migration_invariant_failed',
      scope: 'migrator',
      phase: 'validate',
      migratorId: 'provider_model',
      errorCode: 'source_invalid_identifier'
    },
    {
      kind: 'migration_validation_failed',
      scope: 'migrator',
      phase: 'validate',
      migratorId: 'assistant',
      errorCode: 'validation_count_mismatch'
    },
    {
      kind: 'migration_finalize_failed',
      scope: 'database',
      phase: 'finalize',
      errorCode: 'validation_foreign_key'
    },
    {
      kind: 'process_interrupted',
      scope: 'engine',
      phase: 'interrupted',
      errorCode: 'renderer_process_gone'
    }
  ] as const)('accepts compact $kind diagnostics', (failure) => {
    expect(migrationDiagnosticFailureSchema.parse(failure)).toEqual(failure)
  })

  it('rejects diagnostic evidence fields', () => {
    expect(
      migrationDiagnosticFailureSchema.safeParse({
        kind: 'migration_write_failed',
        scope: 'migrator',
        phase: 'execute',
        migratorId: 'chat',
        errorCode: 'sqlite_constraint',
        evidence: { kind: 'failed_write', truncated: false, values: [] }
      }).success
    ).toBe(false)
  })

  it('rejects raw error details', () => {
    expect(
      migrationDiagnosticFailureSchema.safeParse({
        kind: 'preboot_failed',
        scope: 'gate',
        phase: 'initialize',
        errorCode: 'database_initialize_failed',
        message: 'private path',
        stack: 'private stack'
      }).success
    ).toBe(false)
  })
})
