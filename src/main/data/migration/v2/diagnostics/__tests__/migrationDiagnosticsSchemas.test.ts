import { describe, expect, it } from 'vitest'

import {
  MIGRATION_FAILURE_ERROR_CODES,
  MIGRATION_FAILURE_KINDS,
  migrationDiagnosticAttemptSchema,
  migrationDiagnosticFailureSchema,
  migrationDiagnosticsCheckpointSchema
} from '../migrationDiagnosticsSchemas'

const startedAt = '2026-07-21T08:00:00.000Z'
const endedAt = '2026-07-21T08:01:00.000Z'

const versionGateEvidence = {
  kind: 'version_gate',
  context: {
    reason: 'no_version_log',
    currentVersion: '2.0.0',
    previousVersion: null,
    requiredVersion: '1.9.0',
    gatewayVersion: null,
    directorySelectionRole: 'default',
    versionLog: { state: 'missing' }
  }
} as const

const location = { scope: 'migrator', phase: 'execute', migratorId: 'chat' } as const

const failures = [
  {
    kind: 'upgrade_path_blocked',
    scope: 'gate',
    phase: 'validate',
    errorCode: 'no_version_log',
    evidence: versionGateEvidence
  },
  {
    kind: 'preboot_failed',
    scope: 'database',
    phase: 'initialize',
    errorCode: 'database_initialize_failed'
  },
  {
    kind: 'renderer_export_failed',
    scope: 'renderer_export',
    phase: 'finalize',
    errorCode: 'source_parse_failed',
    evidence: { kind: 'renderer_export', sourceRole: 'redux', operationRole: 'parse' }
  },
  {
    kind: 'source_prepare_failed',
    scope: 'migrator',
    phase: 'prepare',
    migratorId: 'mcp_server',
    errorCode: 'source_required_records_rejected',
    evidence: {
      kind: 'all_required_rows_rejected',
      sourceRole: 'mcp_server',
      fieldRole: 'source_id',
      rejectedCountBucket: '2-10'
    }
  },
  {
    kind: 'migration_write_failed',
    scope: 'migrator',
    phase: 'execute',
    migratorId: 'chat',
    errorCode: 'sqlite_too_big',
    evidence: {
      kind: 'failed_write',
      operationRole: 'insert',
      values: [{ role: 'text_value', kind: 'string', byteLength: 262_145, byteLengthBucket: '262145+' }]
    }
  },
  {
    kind: 'migration_invariant_failed',
    scope: 'migrator',
    phase: 'execute',
    migratorId: 'provider_model',
    errorCode: 'source_invalid_identifier',
    evidence: {
      kind: 'invariant',
      invariantRole: 'identifier',
      identifierRole: 'provider_id',
      rule: 'contains_separator'
    }
  },
  {
    kind: 'migration_validation_failed',
    scope: 'migrator',
    phase: 'validate',
    migratorId: 'assistant',
    errorCode: 'validation_count_mismatch',
    evidence: {
      kind: 'validation',
      checkRole: 'count',
      expectedCountBucket: '11+',
      actualCountBucket: '2-10'
    }
  },
  {
    kind: 'migration_finalize_failed',
    scope: 'engine',
    phase: 'finalize',
    errorCode: 'validation_status',
    evidence: { kind: 'validation', checkRole: 'status' }
  },
  {
    kind: 'process_interrupted',
    scope: 'engine',
    phase: 'interrupted',
    errorCode: 'process_interrupted',
    evidence: { kind: 'interruption', lastLocation: location, recoverySource: 'checkpoint' }
  }
] as const

describe('migrationDiagnosticFailureSchema', () => {
  it('exposes the fixed failure-kind allowlist', () => {
    expect(MIGRATION_FAILURE_KINDS).toEqual(failures.map((failure) => failure.kind))
  })

  it('exposes only blocking root error codes', () => {
    expect(MIGRATION_FAILURE_ERROR_CODES).toContain('sqlite_too_big')
    expect(MIGRATION_FAILURE_ERROR_CODES).toContain('source_required_records_rejected')
    expect(MIGRATION_FAILURE_ERROR_CODES).toContain('version_window_failed')
    expect(MIGRATION_FAILURE_ERROR_CODES).not.toContain('database_diagnostics_timeout')
    expect(MIGRATION_FAILURE_ERROR_CODES).not.toContain('archive_failed')
    expect(MIGRATION_FAILURE_ERROR_CODES).not.toContain('bundle_save_failed')
  })

  it.each(failures)('accepts the fixed $kind failure', (failure) => {
    expect(migrationDiagnosticFailureSchema.parse(failure)).toEqual(failure)
  })

  it.each([
    ['no_version_log', versionGateEvidence],
    [
      'v1_too_old',
      {
        kind: 'version_gate',
        context: {
          reason: 'v1_too_old',
          currentVersion: '2.0.0',
          previousVersion: '1.8.4',
          requiredVersion: '1.9.0',
          gatewayVersion: null,
          directorySelectionRole: 'legacy_exact',
          versionLog: { state: 'parsed', validRecordCountBucket: '2+', invalidRecordCountBucket: '0' }
        }
      }
    ],
    [
      'v2_gateway_skipped',
      {
        kind: 'version_gate',
        context: {
          reason: 'v2_gateway_skipped',
          currentVersion: '2.1.0',
          previousVersion: '1.9.11',
          requiredVersion: null,
          gatewayVersion: '2.0.0',
          directorySelectionRole: 'boot_config',
          versionLog: { state: 'parsed', validRecordCountBucket: '1', invalidRecordCountBucket: '1' }
        }
      }
    ]
  ] as const)('accepts the %s upgrade block', (errorCode, evidence) => {
    expect(
      migrationDiagnosticFailureSchema.safeParse({
        kind: 'upgrade_path_blocked',
        scope: 'gate',
        phase: 'validate',
        errorCode,
        evidence
      }).success
    ).toBe(true)
  })

  it.each([
    ['upgrade_path_blocked', { kind: 'renderer_export', sourceRole: 'redux', operationRole: 'read' }],
    [
      'renderer_export_failed',
      { kind: 'all_required_rows_rejected', sourceRole: 'mcp_server', fieldRole: 'source_id', rejectedCountBucket: '1' }
    ],
    ['source_prepare_failed', { kind: 'failed_write', operationRole: 'insert', values: [] }],
    ['migration_write_failed', { kind: 'invariant', invariantRole: 'foreign_key' }],
    ['migration_invariant_failed', { kind: 'validation', checkRole: 'status' }],
    ['migration_validation_failed', { kind: 'interruption', lastLocation: location, recoverySource: 'checkpoint' }],
    ['process_interrupted', { kind: 'validation', checkRole: 'status' }]
  ] as const)('rejects %s with mismatched evidence', (kind, evidence) => {
    const base = failures.find((failure) => failure.kind === kind)
    expect(migrationDiagnosticFailureSchema.safeParse({ ...base, evidence }).success).toBe(false)
  })

  it('allows version-gate evidence on preboot only for version-window failure', () => {
    expect(
      migrationDiagnosticFailureSchema.safeParse({
        kind: 'preboot_failed',
        scope: 'gate',
        phase: 'finalize',
        errorCode: 'version_window_failed',
        evidence: versionGateEvidence
      }).success
    ).toBe(true)
    expect(
      migrationDiagnosticFailureSchema.safeParse({
        kind: 'preboot_failed',
        scope: 'database',
        phase: 'initialize',
        errorCode: 'database_initialize_failed',
        evidence: versionGateEvidence
      }).success
    ).toBe(false)
  })

  it.each(['rawError', 'message', 'stack', 'path', 'sql', 'recordId', 'value', 'hash'])(
    'rejects the arbitrary %s field',
    (field) => {
      expect(migrationDiagnosticFailureSchema.safeParse({ ...failures[4], [field]: 'privacy-canary' }).success).toBe(
        false
      )
    }
  )

  it('rejects arbitrary migrator IDs and inconsistent failed-write measurements', () => {
    expect(migrationDiagnosticFailureSchema.safeParse({ ...failures[4], migratorId: 'private-migrator' }).success).toBe(
      false
    )
    expect(
      migrationDiagnosticFailureSchema.safeParse({
        ...failures[4],
        evidence: {
          kind: 'failed_write',
          operationRole: 'insert',
          values: [{ role: 'blob_value', kind: 'blob', byteLength: 10, byteLengthBucket: '262145+' }]
        }
      }).success
    ).toBe(false)
  })
})

describe('migrationDiagnosticAttemptSchema', () => {
  it.each([
    { trigger: 'initial', status: 'in_progress', startedAt, lastLocation: location },
    {
      trigger: 'manual_retry',
      status: 'completed',
      startedAt,
      endedAt,
      lastLocation: location,
      warningCountBucket: '2-10'
    },
    {
      trigger: 'initial',
      status: 'failed',
      startedAt,
      endedAt,
      lastLocation: location,
      failure: failures[4]
    },
    {
      trigger: 'recovered_retry',
      status: 'interrupted',
      startedAt,
      endedAt,
      lastLocation: location,
      failure: failures[8]
    }
  ] as const)('accepts the strict $status attempt', (attempt) => {
    expect(migrationDiagnosticAttemptSchema.parse(attempt)).toEqual(attempt)
  })

  it('rejects old event timelines', () => {
    expect(
      migrationDiagnosticAttemptSchema.safeParse({
        trigger: 'initial',
        status: 'in_progress',
        startedAt,
        lastLocation: location,
        events: []
      }).success
    ).toBe(false)
  })
})

describe('migrationDiagnosticsCheckpointSchema', () => {
  it('keeps only previous and current attempt summaries', () => {
    const checkpoint = {
      formatVersion: 1,
      app: { version: '2.0.0', platform: 'darwin', arch: 'arm64' },
      state: 'active',
      previous: {
        trigger: 'initial',
        status: 'failed',
        startedAt,
        endedAt,
        lastLocation: location,
        failure: failures[4]
      },
      current: { trigger: 'manual_retry', status: 'in_progress', startedAt, lastLocation: location }
    } as const

    expect(migrationDiagnosticsCheckpointSchema.parse(checkpoint)).toEqual(checkpoint)
  })

  it.each(['attempts', 'events', 'sessionId'])('rejects the legacy %s field', (field) => {
    expect(
      migrationDiagnosticsCheckpointSchema.safeParse({
        formatVersion: 1,
        app: { version: 'unknown', platform: 'other', arch: 'other' },
        state: 'active',
        [field]: []
      }).success
    ).toBe(false)
  })
})
