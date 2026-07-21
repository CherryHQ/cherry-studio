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

const migrationDiagnosticMigratorIdSchema = z.enum(MIGRATION_DIAGNOSTIC_MIGRATOR_IDS)
const migrationAttemptTriggerSchema = z.enum(['initial', 'manual_retry', 'recovered_retry'])
const migrationDiagnosticsPlatformSchema = z.enum(['darwin', 'win32', 'linux', 'other'])
const migrationDiagnosticsArchSchema = z.enum(['x64', 'arm64', 'ia32', 'other'])
const migrationDiagnosticCurrentVersionSchema = z.union([z.literal('unknown'), z.string().min(1).max(128)])

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
  'file_invalid_type',
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

const migrationFailureErrorCodeSchema = z.enum(MIGRATION_FAILURE_ERROR_CODES)

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
  'file_invalid_type',
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
      errorCode: z.enum(['no_version_log', 'v1_too_old', 'v2_gateway_skipped'])
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
      ])
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
        'file_invalid_type',
        'file_missing',
        'file_permission',
        'file_readonly',
        'file_io'
      ])
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
      ])
    })
    .strict(),
  z
    .object({
      kind: z.literal('migration_write_failed'),
      scope: z.enum(['migrator', 'database']),
      phase: z.enum(['execute', 'finalize']),
      migratorId: migrationDiagnosticMigratorIdSchema.optional(),
      errorCode: databaseOrFileFailureCodeSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('migration_invariant_failed'),
      scope: z.enum(['engine', 'migrator', 'database']),
      phase: z.enum(['execute', 'validate', 'finalize']),
      migratorId: migrationDiagnosticMigratorIdSchema.optional(),
      errorCode: z.enum(['unknown_error', 'sqlite_constraint', 'source_invalid_identifier', 'validation_foreign_key'])
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
      ])
    })
    .strict(),
  z
    .object({
      kind: z.literal('migration_finalize_failed'),
      scope: z.enum(['engine', 'database']),
      phase: z.literal('finalize'),
      errorCode: z.union([databaseOrFileFailureCodeSchema, z.enum(['validation_foreign_key', 'validation_status'])])
    })
    .strict(),
  z
    .object({
      kind: z.literal('process_interrupted'),
      scope: z.literal('engine'),
      phase: z.literal('interrupted'),
      errorCode: z.enum(['renderer_process_gone', 'renderer_unresponsive', 'process_interrupted'])
    })
    .strict()
])

export const migrationDiagnosticFailureSchema = migrationDiagnosticFailureUnionSchema

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
export type MigrationAttemptTrigger = z.infer<typeof migrationAttemptTriggerSchema>
export type MigrationDiagnosticsPlatform = z.infer<typeof migrationDiagnosticsPlatformSchema>
export type MigrationDiagnosticsArch = z.infer<typeof migrationDiagnosticsArchSchema>
export type MigrationFailureErrorCode = z.infer<typeof migrationFailureErrorCodeSchema>
export type MigrationDiagnosticLocation = z.infer<typeof migrationDiagnosticLocationSchema>
export type MigrationDiagnosticFailure = z.infer<typeof migrationDiagnosticFailureSchema>
export type MigrationDiagnosticAttempt = z.infer<typeof migrationDiagnosticAttemptSchema>
export type MigrationDiagnosticFinishedAttempt = z.infer<typeof migrationDiagnosticFinishedAttemptSchema>
export type MigrationAttemptFinish =
  | { status: 'completed' }
  | { status: 'failed'; failure: MigrationDiagnosticFailure }
  | { status: 'interrupted'; failure: Extract<MigrationDiagnosticFailure, { kind: 'process_interrupted' }> }
export type MigrationDiagnosticsSnapshot = Readonly<z.infer<typeof migrationDiagnosticsCheckpointSchema>>
