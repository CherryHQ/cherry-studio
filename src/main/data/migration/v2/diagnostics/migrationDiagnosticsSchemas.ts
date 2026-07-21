import { migrationRendererExportFailureReportSchema } from '@shared/data/migration/v2/diagnostics'
import semver from 'semver'
import * as z from 'zod'

/** Fixed production migrator identifiers safe to expose in strict diagnostics. */
const MIGRATION_DIAGNOSTIC_MIGRATOR_IDS = Object.freeze([
  'bootConfig',
  'preferences',
  'note',
  'miniapp',
  'mcp_server',
  'provider_model',
  'assistant',
  'file',
  'agents',
  'knowledge',
  'knowledge_vector',
  'chat',
  'painting',
  'translate',
  'prompt'
] as const)

const MIGRATION_DIAGNOSTIC_DIRECTORY_SELECTION_ROLES = Object.freeze([
  'current',
  'boot_config',
  'legacy_exact',
  'legacy_fuzzy_eligible',
  'legacy_fuzzy_blocked',
  'default',
  'unknown'
] as const)

const MIGRATION_DIAGNOSTIC_VERSION_LOG_COUNT_BUCKETS = Object.freeze(['0', '1', '2+'] as const)

const migrationDiagnosticNormalizedVersionSchema = z
  .string()
  .max(128)
  .refine((value) => semver.valid(value) === value, 'Expected a normalized semantic version')
const migrationDiagnosticCurrentVersionSchema = z.union([
  z.literal('unknown'),
  migrationDiagnosticNormalizedVersionSchema
])

const migrationDiagnosticDirectorySelectionRoleSchema = z.enum(MIGRATION_DIAGNOSTIC_DIRECTORY_SELECTION_ROLES)
const migrationDiagnosticVersionLogCountBucketSchema = z.enum(MIGRATION_DIAGNOSTIC_VERSION_LOG_COUNT_BUCKETS)
const migrationDiagnosticVersionLogContextSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('missing') }).strict(),
  z.object({ state: z.literal('read_failed') }).strict(),
  z
    .object({
      state: z.literal('parsed'),
      validRecordCountBucket: migrationDiagnosticVersionLogCountBucketSchema,
      invalidRecordCountBucket: migrationDiagnosticVersionLogCountBucketSchema
    })
    .strict()
])

const migrationVersionGateCommonFields = {
  currentVersion: migrationDiagnosticCurrentVersionSchema,
  directorySelectionRole: migrationDiagnosticDirectorySelectionRoleSchema,
  versionLog: migrationDiagnosticVersionLogContextSchema
}

const migrationVersionGateContextSchema = z.discriminatedUnion('reason', [
  z
    .object({
      reason: z.literal('no_version_log'),
      ...migrationVersionGateCommonFields,
      previousVersion: z.null(),
      requiredVersion: migrationDiagnosticNormalizedVersionSchema,
      gatewayVersion: z.null()
    })
    .strict(),
  z
    .object({
      reason: z.literal('v1_too_old'),
      ...migrationVersionGateCommonFields,
      previousVersion: migrationDiagnosticNormalizedVersionSchema,
      requiredVersion: migrationDiagnosticNormalizedVersionSchema,
      gatewayVersion: z.null()
    })
    .strict(),
  z
    .object({
      reason: z.literal('v2_gateway_skipped'),
      ...migrationVersionGateCommonFields,
      previousVersion: migrationDiagnosticNormalizedVersionSchema,
      requiredVersion: z.null(),
      gatewayVersion: migrationDiagnosticNormalizedVersionSchema
    })
    .strict()
])

const rendererExportReportSchemas = migrationRendererExportFailureReportSchema.options
const migrationDiagnosticMigratorIdSchema = z.enum(MIGRATION_DIAGNOSTIC_MIGRATOR_IDS)

const migrationAttemptTriggerSchema = z.enum(['initial', 'manual_retry', 'recovered_retry'])
const migrationDiagnosticsPlatformSchema = z.enum(['darwin', 'win32', 'linux', 'other'])
const migrationDiagnosticsArchSchema = z.enum(['x64', 'arm64', 'ia32', 'other'])

const MIGRATION_FAILURE_ERROR_CODES = [
  'unknown_error',
  'sqlite_open_failed',
  'sqlite_corrupt',
  'sqlite_not_database',
  'sqlite_schema',
  'sqlite_constraint',
  'sqlite_readonly',
  'sqlite_permission',
  'sqlite_too_big',
  'sqlite_busy',
  'sqlite_locked',
  'sqlite_io',
  'sqlite_unknown',
  'file_missing',
  'file_permission',
  'file_readonly',
  'file_io',
  'source_read_failed',
  'source_parse_failed',
  'source_serialization_failed',
  'source_required_records_rejected',
  'source_invalid_identifier',
  'validation_count_mismatch',
  'validation_foreign_key',
  'validation_status',
  'renderer_process_gone',
  'renderer_unresponsive',
  'process_interrupted',
  'no_version_log',
  'v1_too_old',
  'v2_gateway_skipped',
  'path_resolution_failed',
  'legacy_data_location_unavailable',
  'data_location_pin_failed',
  'database_initialize_failed',
  'migration_status_probe_failed',
  'version_check_failed',
  'version_window_failed',
  'migration_window_failed'
] as const

const MIGRATION_DIAGNOSTIC_COUNT_BUCKETS = ['0', '1', '2-10', '11+'] as const

const migrationFailureErrorCodeSchema = z.enum(MIGRATION_FAILURE_ERROR_CODES)
const migrationDiagnosticCountBucketSchema = z.enum(MIGRATION_DIAGNOSTIC_COUNT_BUCKETS)

export const migrationDiagnosticLocationSchema = z
  .object({
    scope: z.enum(['gate', 'renderer_export', 'engine', 'migrator', 'database']),
    phase: z.enum(['resolve_paths', 'initialize', 'prepare', 'execute', 'validate', 'finalize', 'interrupted']),
    migratorId: migrationDiagnosticMigratorIdSchema.optional()
  })
  .strict()

export const migrationDiagnosticAppMetadataSchema = z
  .object({
    version: migrationDiagnosticCurrentVersionSchema,
    platform: migrationDiagnosticsPlatformSchema,
    arch: migrationDiagnosticsArchSchema
  })
  .strict()

const migrationVersionGateFailureEvidenceSchema = z
  .object({
    kind: z.literal('version_gate'),
    context: migrationVersionGateContextSchema
  })
  .strict()

const migrationRendererExportEvidenceSchema = z.discriminatedUnion('sourceRole', [
  rendererExportReportSchemas[0].extend({ kind: z.literal('renderer_export') }),
  rendererExportReportSchemas[1].extend({ kind: z.literal('renderer_export') }),
  rendererExportReportSchemas[2].extend({ kind: z.literal('renderer_export') }),
  rendererExportReportSchemas[3].extend({ kind: z.literal('renderer_export') })
])

const migrationAllRequiredRowsRejectedEvidenceSchema = z
  .object({
    kind: z.literal('all_required_rows_rejected'),
    sourceRole: z.literal('mcp_server'),
    fieldRole: z.literal('source_id'),
    rejectedCountBucket: migrationDiagnosticCountBucketSchema.exclude(['0'])
  })
  .strict()

const MIGRATION_FAILED_WRITE_BYTE_LENGTH_BUCKETS = [
  '0',
  '1-256',
  '257-4096',
  '4097-65536',
  '65537-262144',
  '262145+'
] as const

const migrationFailedWriteByteLengthBucketSchema = z.enum(MIGRATION_FAILED_WRITE_BYTE_LENGTH_BUCKETS)

function byteLengthBucket(byteLength: number): (typeof MIGRATION_FAILED_WRITE_BYTE_LENGTH_BUCKETS)[number] {
  if (byteLength === 0) return '0'
  if (byteLength <= 256) return '1-256'
  if (byteLength <= 4_096) return '257-4096'
  if (byteLength <= 65_536) return '4097-65536'
  if (byteLength <= 262_144) return '65537-262144'
  return '262145+'
}

const migrationFailedWriteValueMeasurementSchema = z
  .discriminatedUnion('role', [
    z
      .object({
        role: z.literal('text_value'),
        kind: z.literal('string'),
        byteLength: z.number().int().nonnegative().max(262_145),
        byteLengthBucket: migrationFailedWriteByteLengthBucketSchema
      })
      .strict(),
    z
      .object({
        role: z.literal('json_value'),
        kind: z.literal('json'),
        byteLength: z.number().int().nonnegative().max(262_145),
        byteLengthBucket: migrationFailedWriteByteLengthBucketSchema
      })
      .strict()
  ])
  .superRefine((measurement, ctx) => {
    if (measurement.byteLengthBucket !== byteLengthBucket(measurement.byteLength)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Failed-write byte length and bucket must agree',
        path: ['byteLengthBucket']
      })
    }
  })

const migrationFailedWriteEvidenceSchema = z
  .object({
    kind: z.literal('failed_write'),
    truncated: z.boolean(),
    values: z.array(migrationFailedWriteValueMeasurementSchema).max(3)
  })
  .strict()

const migrationInvariantEvidenceSchema = z.union([
  z.object({ kind: z.literal('invariant'), invariantRole: z.literal('foreign_key') }).strict(),
  z
    .object({
      kind: z.literal('invariant'),
      invariantRole: z.literal('identifier'),
      identifierRole: z.literal('provider_id'),
      rule: z.enum(['empty', 'contains_separator'])
    })
    .strict(),
  z
    .object({
      kind: z.literal('invariant'),
      invariantRole: z.literal('identifier'),
      identifierRole: z.literal('model_id'),
      rule: z.enum(['empty', 'contains_reserved_route_character'])
    })
    .strict()
])

const migrationValidationEvidenceSchema = z.union([
  z
    .object({
      kind: z.literal('validation'),
      checkRole: z.literal('count'),
      expectedCountBucket: migrationDiagnosticCountBucketSchema,
      actualCountBucket: migrationDiagnosticCountBucketSchema
    })
    .strict(),
  z.object({ kind: z.literal('validation'), checkRole: z.literal('foreign_key') }).strict(),
  z.object({ kind: z.literal('validation'), checkRole: z.literal('status') }).strict()
])

const migrationInterruptionEvidenceSchema = z
  .object({
    kind: z.literal('interruption'),
    recoverySource: z.enum(['live_renderer_event', 'checkpoint'])
  })
  .strict()

const databaseOrFileFailureCodeSchema = z.enum([
  'unknown_error',
  'sqlite_open_failed',
  'sqlite_corrupt',
  'sqlite_not_database',
  'sqlite_schema',
  'sqlite_constraint',
  'sqlite_readonly',
  'sqlite_permission',
  'sqlite_too_big',
  'sqlite_busy',
  'sqlite_locked',
  'sqlite_io',
  'sqlite_unknown',
  'file_missing',
  'file_permission',
  'file_readonly',
  'file_io'
])

const migrationDiagnosticFailureUnionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('upgrade_path_blocked'),
      scope: z.literal('gate'),
      phase: z.literal('validate'),
      errorCode: z.enum(['no_version_log', 'v1_too_old', 'v2_gateway_skipped']),
      evidence: migrationVersionGateFailureEvidenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('preboot_failed'),
      scope: z.enum(['gate', 'engine', 'database']),
      phase: z.enum(['resolve_paths', 'initialize', 'validate', 'finalize']),
      errorCode: z.union([
        databaseOrFileFailureCodeSchema,
        z.enum([
          'path_resolution_failed',
          'legacy_data_location_unavailable',
          'data_location_pin_failed',
          'database_initialize_failed',
          'migration_status_probe_failed',
          'version_check_failed',
          'version_window_failed',
          'migration_window_failed'
        ])
      ]),
      evidence: migrationVersionGateFailureEvidenceSchema.optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('renderer_export_failed'),
      scope: z.literal('renderer_export'),
      phase: z.literal('finalize'),
      errorCode: z.enum([
        'unknown_error',
        'source_read_failed',
        'source_parse_failed',
        'source_serialization_failed',
        'file_missing',
        'file_permission',
        'file_readonly',
        'file_io'
      ]),
      evidence: migrationRendererExportEvidenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('source_prepare_failed'),
      scope: z.enum(['engine', 'migrator']),
      phase: z.literal('prepare'),
      migratorId: migrationDiagnosticMigratorIdSchema.optional(),
      errorCode: z.union([
        databaseOrFileFailureCodeSchema,
        z.enum(['source_parse_failed', 'source_required_records_rejected'])
      ]),
      evidence: migrationAllRequiredRowsRejectedEvidenceSchema.optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('migration_write_failed'),
      scope: z.enum(['migrator', 'database']),
      phase: z.enum(['execute', 'finalize']),
      migratorId: migrationDiagnosticMigratorIdSchema.optional(),
      errorCode: databaseOrFileFailureCodeSchema,
      evidence: migrationFailedWriteEvidenceSchema.optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('migration_invariant_failed'),
      scope: z.enum(['engine', 'migrator', 'database']),
      phase: z.enum(['execute', 'validate', 'finalize']),
      migratorId: migrationDiagnosticMigratorIdSchema.optional(),
      errorCode: z.enum(['unknown_error', 'sqlite_constraint', 'source_invalid_identifier', 'validation_foreign_key']),
      evidence: migrationInvariantEvidenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('migration_validation_failed'),
      scope: z.enum(['engine', 'migrator', 'database']),
      phase: z.literal('validate'),
      migratorId: migrationDiagnosticMigratorIdSchema.optional(),
      errorCode: z.union([
        databaseOrFileFailureCodeSchema,
        z.enum(['validation_count_mismatch', 'validation_foreign_key', 'validation_status'])
      ]),
      evidence: migrationValidationEvidenceSchema.optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('migration_finalize_failed'),
      scope: z.enum(['engine', 'database']),
      phase: z.literal('finalize'),
      errorCode: z.union([databaseOrFileFailureCodeSchema, z.enum(['validation_foreign_key', 'validation_status'])]),
      evidence: migrationValidationEvidenceSchema.optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('process_interrupted'),
      scope: z.literal('engine'),
      phase: z.literal('interrupted'),
      errorCode: z.enum(['renderer_process_gone', 'renderer_unresponsive', 'process_interrupted']),
      evidence: migrationInterruptionEvidenceSchema
    })
    .strict()
])

export const migrationDiagnosticFailureSchema = migrationDiagnosticFailureUnionSchema.superRefine((failure, ctx) => {
  if (failure.kind === 'upgrade_path_blocked' && failure.errorCode !== failure.evidence.context.reason) {
    ctx.addIssue({
      code: 'custom',
      message: 'Upgrade-path code must match its version-gate reason',
      path: ['errorCode']
    })
  }
  if (failure.kind === 'preboot_failed') {
    const shouldHaveVersionEvidence = failure.errorCode === 'version_window_failed'
    if (shouldHaveVersionEvidence !== (failure.evidence !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Only a version-window preboot failure carries version-gate evidence',
        path: ['evidence']
      })
    }
  }
  if (failure.kind === 'source_prepare_failed') {
    const aggregate = failure.errorCode === 'source_required_records_rejected'
    if (aggregate !== (failure.evidence !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Only rejected required source rows carry aggregate prepare evidence',
        path: ['evidence']
      })
    }
    if ((failure.scope === 'migrator') !== (failure.migratorId !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Only migrator-scoped prepare failures carry a migrator id',
        path: ['migratorId']
      })
    }
    if (aggregate && failure.scope !== 'migrator') {
      ctx.addIssue({
        code: 'custom',
        message: 'Required-row rejection is owned by a migrator',
        path: ['scope']
      })
    }
  }
  if (failure.kind === 'migration_validation_failed' && failure.errorCode.startsWith('validation_')) {
    if (failure.evidence === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'A validation result failure must carry its fixed check evidence',
        path: ['evidence']
      })
    }
  }
})

const migrationDiagnosticAttemptCommonFields = {
  trigger: migrationAttemptTriggerSchema,
  startedAt: z.string().datetime(),
  lastLocation: migrationDiagnosticLocationSchema
}

const migrationDiagnosticInProgressAttemptSchema = z
  .object({
    ...migrationDiagnosticAttemptCommonFields,
    status: z.literal('in_progress')
  })
  .strict()

const migrationDiagnosticCompletedAttemptSchema = z
  .object({
    ...migrationDiagnosticAttemptCommonFields,
    status: z.literal('completed'),
    endedAt: z.string().datetime()
  })
  .strict()

const migrationDiagnosticFailedAttemptSchema = z
  .object({
    ...migrationDiagnosticAttemptCommonFields,
    status: z.literal('failed'),
    endedAt: z.string().datetime(),
    failure: migrationDiagnosticFailureSchema
  })
  .strict()

const migrationDiagnosticInterruptedAttemptSchema = z
  .object({
    ...migrationDiagnosticAttemptCommonFields,
    status: z.literal('interrupted'),
    endedAt: z.string().datetime(),
    failure: migrationDiagnosticFailureUnionSchema.options[8]
  })
  .strict()

export const migrationDiagnosticAttemptSchema = z.discriminatedUnion('status', [
  migrationDiagnosticInProgressAttemptSchema,
  migrationDiagnosticCompletedAttemptSchema,
  migrationDiagnosticFailedAttemptSchema,
  migrationDiagnosticInterruptedAttemptSchema
])

export const migrationDiagnosticFinishedAttemptSchema = z.union([
  migrationDiagnosticCompletedAttemptSchema,
  migrationDiagnosticFailedAttemptSchema,
  migrationDiagnosticInterruptedAttemptSchema
])

export const migrationDiagnosticsCheckpointSchema = z
  .object({
    formatVersion: z.literal(1),
    app: migrationDiagnosticAppMetadataSchema,
    state: z.enum(['active', 'failed', 'completed']),
    previous: migrationDiagnosticFinishedAttemptSchema.optional(),
    current: migrationDiagnosticAttemptSchema.optional()
  })
  .strict()

export type MigrationDiagnosticMigratorId = z.infer<typeof migrationDiagnosticMigratorIdSchema>
export type MigrationVersionGateContext = z.infer<typeof migrationVersionGateContextSchema>
export type MigrationAttemptTrigger = z.infer<typeof migrationAttemptTriggerSchema>
export type MigrationDiagnosticsPlatform = z.infer<typeof migrationDiagnosticsPlatformSchema>
export type MigrationDiagnosticsArch = z.infer<typeof migrationDiagnosticsArchSchema>
export type MigrationFailureErrorCode = z.infer<typeof migrationFailureErrorCodeSchema>
export type MigrationDiagnosticLocation = z.infer<typeof migrationDiagnosticLocationSchema>
export type MigrationDiagnosticFailure = z.infer<typeof migrationDiagnosticFailureSchema>
export type MigrationDiagnosticFailureEvidence = NonNullable<MigrationDiagnosticFailure['evidence']>
export type MigrationDiagnosticAttempt = z.infer<typeof migrationDiagnosticAttemptSchema>
export type MigrationDiagnosticFinishedAttempt = z.infer<typeof migrationDiagnosticFinishedAttemptSchema>
export type MigrationAttemptFinish =
  | { status: 'completed' }
  | { status: 'failed'; failure: MigrationDiagnosticFailure }
  | { status: 'interrupted'; failure: Extract<MigrationDiagnosticFailure, { kind: 'process_interrupted' }> }
export type MigrationDiagnosticsSnapshot = Readonly<z.infer<typeof migrationDiagnosticsCheckpointSchema>>
