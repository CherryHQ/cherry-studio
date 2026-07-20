import { migrationRendererExportFailureReportSchema } from '@shared/data/migration/v2/diagnostics'
import * as z from 'zod'

export const MIGRATION_ERROR_CODES = [
  'unknown',
  'path_unavailable',
  'permission_denied',
  'disk_full',
  'sqlite_corrupt',
  'sqlite_not_database',
  'sqlite_too_big',
  'sqlite_constraint',
  'sqlite_schema',
  'source_parse',
  'missing_required_field',
  'invalid_identifier',
  'process_timeout',
  'renderer_process_gone',
  'renderer_unresponsive',
  'archive_write',
  'upgrade_path_blocked'
] as const

export const MIGRATION_ERROR_CATEGORIES = [
  'filesystem',
  'database_read',
  'database_write',
  'source',
  'process',
  'archive',
  'unknown'
] as const

/** Fixed production migrator identifiers safe to expose in strict diagnostics. */
export const MIGRATION_DIAGNOSTIC_MIGRATOR_IDS = Object.freeze([
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

export const MIGRATION_DIAGNOSTIC_DIRECTORY_SELECTION_ROLES = Object.freeze([
  'current',
  'boot_config',
  'legacy_exact',
  'legacy_fuzzy_eligible',
  'legacy_fuzzy_blocked',
  'default',
  'unknown'
] as const)

export const MIGRATION_DIAGNOSTIC_VERSION_LOG_COUNT_BUCKETS = Object.freeze(['0', '1', '2+', 'unknown'] as const)

export const PAYLOAD_PROFILE_TARGETS = [
  'preference',
  'assistant',
  'assistant_relation',
  'mcp_server',
  'user_provider',
  'user_model',
  'mini_app',
  'file_entry',
  'knowledge_base',
  'knowledge_item',
  'topic',
  'message',
  'file_ref',
  'pin',
  'painting',
  'translate_language',
  'translate_history',
  'prompt',
  'note',
  'agent_task',
  'agent_message',
  'agent_workspace',
  'agent_relation',
  'knowledge_vector_status',
  'knowledge_vector_rebuild'
] as const

export const PAYLOAD_PROFILE_SLOTS = [
  'value',
  'name',
  'group',
  'prompt',
  'description',
  'command',
  'args',
  'env',
  'endpointConfigs',
  'apiKeys',
  'authConfig',
  'apiFeatures',
  'providerSettings',
  'capabilities',
  'inputModalities',
  'outputModalities',
  'endpointTypes',
  'customEndpointUrl',
  'reasoning',
  'parameters',
  'pricing',
  'notes',
  'userOverrides',
  'url',
  'logoKey',
  'background',
  'supportedRegions',
  'configuration',
  'nameKey',
  'externalPath',
  'chunkSeparator',
  'data',
  'searchableText',
  'messageSnapshot',
  'stats',
  'payload',
  'path',
  'rootPath',
  'metadata',
  'content',
  'sourceText',
  'targetText',
  'emoji',
  'trigger',
  'jobInputTemplate',
  'catchUpPolicy',
  'error',
  'vectorBlob'
] as const

export const LENGTH_BUCKETS = ['0', '1-256', '257-4096', '4097-65536', '65537-262144', '262145+'] as const

export const ROW_COUNT_BUCKETS = ['0', '1', '2-10', '11-100', '101-1000', '1001+'] as const

export const migrationErrorCodeSchema = z.enum(MIGRATION_ERROR_CODES)
export const migrationErrorCategorySchema = z.enum(MIGRATION_ERROR_CATEGORIES)
export const payloadProfileTargetSchema = z.enum(PAYLOAD_PROFILE_TARGETS)
export const payloadProfileSlotSchema = z.enum(PAYLOAD_PROFILE_SLOTS)
export const lengthBucketSchema = z.enum(LENGTH_BUCKETS)
export const rowCountBucketSchema = z.enum(ROW_COUNT_BUCKETS)
export const payloadTraversalSchema = z.enum(['complete', 'truncated'])

const stringPayloadLengthSlotProfileSchema = z
  .object({
    slot: payloadProfileSlotSchema,
    kind: z.literal('string'),
    totalByteLengthBucket: lengthBucketSchema,
    maxCharLengthBucket: lengthBucketSchema,
    maxByteLengthBucket: lengthBucketSchema
  })
  .strict()

const bytesPayloadLengthSlotProfileSchema = z
  .object({
    slot: payloadProfileSlotSchema,
    kind: z.literal('bytes'),
    totalByteLengthBucket: lengthBucketSchema,
    maxByteLengthBucket: lengthBucketSchema
  })
  .strict()

const jsonPayloadLengthSlotProfileSchema = z
  .object({
    slot: payloadProfileSlotSchema,
    kind: z.literal('json'),
    totalSerializedByteLengthBucket: lengthBucketSchema,
    maxSerializedByteLengthBucket: lengthBucketSchema,
    maxStringLeafCharLengthBucket: lengthBucketSchema,
    maxStringLeafByteLengthBucket: lengthBucketSchema,
    traversal: payloadTraversalSchema
  })
  .strict()

const mixedPayloadLengthSlotProfileSchema = z
  .object({
    slot: payloadProfileSlotSchema,
    kind: z.literal('mixed'),
    traversal: payloadTraversalSchema
  })
  .strict()

const unsupportedPayloadLengthSlotProfileSchema = z
  .object({
    slot: payloadProfileSlotSchema,
    kind: z.literal('unsupported')
  })
  .strict()

const emptyPayloadLengthSlotProfileSchema = z
  .object({
    slot: payloadProfileSlotSchema,
    kind: z.literal('empty')
  })
  .strict()

export const payloadLengthSlotProfileSchema = z.discriminatedUnion('kind', [
  stringPayloadLengthSlotProfileSchema,
  bytesPayloadLengthSlotProfileSchema,
  jsonPayloadLengthSlotProfileSchema,
  mixedPayloadLengthSlotProfileSchema,
  unsupportedPayloadLengthSlotProfileSchema,
  emptyPayloadLengthSlotProfileSchema
])

export const payloadLengthProfileSchema = z
  .object({
    target: payloadProfileTargetSchema,
    rowCountBucket: rowCountBucketSchema,
    profiledByteLengthBucket: lengthBucketSchema,
    maxProfiledRowByteLengthBucket: lengthBucketSchema,
    traversal: payloadTraversalSchema,
    slots: z.array(payloadLengthSlotProfileSchema).max(64)
  })
  .strict()

export const payloadProfileDescriptorSchema = z
  .object({
    target: payloadProfileTargetSchema,
    fields: z.array(payloadProfileSlotSchema).max(64)
  })
  .strict()

const migrationDiagnosticNormalizedVersionSchema = z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/)
const migrationDiagnosticCurrentVersionSchema = z.union([
  z.literal('unknown'),
  migrationDiagnosticNormalizedVersionSchema
])

export const migrationDiagnosticDirectorySelectionRoleSchema = z.enum(MIGRATION_DIAGNOSTIC_DIRECTORY_SELECTION_ROLES)
export const migrationDiagnosticVersionLogCountBucketSchema = z.enum(MIGRATION_DIAGNOSTIC_VERSION_LOG_COUNT_BUCKETS)
export const migrationDiagnosticVersionLogContextSchema = z.discriminatedUnion('state', [
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

export const migrationVersionGateContextSchema = z.discriminatedUnion('reason', [
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
const rendererExportFailureEvidenceSchema = z.discriminatedUnion('sourceRole', [
  rendererExportReportSchemas[0].extend({ kind: z.literal('renderer_export_failure') }),
  rendererExportReportSchemas[1].extend({ kind: z.literal('renderer_export_failure') }),
  rendererExportReportSchemas[2].extend({ kind: z.literal('renderer_export_failure') }),
  rendererExportReportSchemas[3].extend({ kind: z.literal('renderer_export_failure') })
])

const missingRequiredFieldEvidenceSchema = z
  .object({
    kind: z.literal('missing_required_field'),
    fieldRole: z.literal('source_id'),
    affectedCountBucket: z.enum(['1', '2-10', '11+'])
  })
  .strict()

const invalidIdentifierEvidenceSchema = z.discriminatedUnion('identifierRole', [
  z
    .object({
      kind: z.literal('invalid_identifier'),
      identifierRole: z.literal('provider_id'),
      rule: z.enum(['empty', 'contains_separator'])
    })
    .strict(),
  z
    .object({
      kind: z.literal('invalid_identifier'),
      identifierRole: z.literal('model_id'),
      rule: z.enum(['empty', 'contains_reserved_route_character'])
    })
    .strict()
])

export const migrationDiagnosticSemanticEvidenceSchema = z.discriminatedUnion('kind', [
  rendererExportFailureEvidenceSchema,
  missingRequiredFieldEvidenceSchema,
  invalidIdentifierEvidenceSchema
])

export const migrationDiagnosticMigratorIdSchema = z.enum(MIGRATION_DIAGNOSTIC_MIGRATOR_IDS)
export const migrationDiagnosticPersistedMigratorIdSchema = z.enum([...MIGRATION_DIAGNOSTIC_MIGRATOR_IDS, 'unknown'])

const migrationDiagnosticEventFields = {
  scope: z.enum(['gate', 'renderer_export', 'engine', 'migrator', 'database', 'bundle']),
  phase: z.enum(['resolve_paths', 'initialize', 'prepare', 'execute', 'validate', 'finalize', 'save']),
  state: z.enum(['started', 'completed', 'failed', 'interrupted', 'unavailable', 'warning']),
  code: migrationErrorCodeSchema,
  category: migrationErrorCategorySchema.optional(),
  causeDepth: z.number().int().min(0).max(4).optional(),
  payloadProfile: payloadLengthProfileSchema.optional(),
  versionGate: migrationVersionGateContextSchema.optional(),
  semanticEvidence: migrationDiagnosticSemanticEvidenceSchema.optional()
}

interface MigrationDiagnosticEventCandidate {
  readonly scope?: unknown
  readonly phase?: unknown
  readonly state?: unknown
  readonly code?: unknown
  readonly category?: unknown
  readonly migratorId?: unknown
  readonly versionGate?: unknown
  readonly semanticEvidence?: z.infer<typeof migrationDiagnosticSemanticEvidenceSchema>
}

type RendererExportFailureEvidence = Extract<
  z.infer<typeof migrationDiagnosticSemanticEvidenceSchema>,
  { kind: 'renderer_export_failure' }
>

function isValidRendererExportFailureClassification(
  event: MigrationDiagnosticEventCandidate,
  evidence: RendererExportFailureEvidence
): boolean {
  if (evidence.sourceRole === 'redux' && evidence.operationRole === 'parse') {
    return event.code === 'source_parse' && event.category === 'source'
  }

  if (event.code === 'unknown' && event.category === 'unknown') {
    return true
  }

  const isMainOwnedWrite =
    evidence.operationRole === 'write' && (evidence.sourceRole === 'dexie' || evidence.sourceRole === 'local_storage')
  const isFilesystemError =
    event.code === 'path_unavailable' || event.code === 'permission_denied' || event.code === 'disk_full'

  return isMainOwnedWrite && isFilesystemError && event.category === 'filesystem'
}

function validateMigrationDiagnosticEvent(event: MigrationDiagnosticEventCandidate, ctx: z.RefinementCtx): void {
  const isVersionGateEvent =
    event.scope === 'gate' &&
    event.phase === 'validate' &&
    event.state === 'unavailable' &&
    event.code === 'upgrade_path_blocked'

  if (isVersionGateEvent !== (event.versionGate !== undefined)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Upgrade-path block code and context must appear together on the fixed gate event',
      path: ['versionGate']
    })
  }

  const isRendererExportFailureEvent =
    event.scope === 'renderer_export' && event.phase === 'finalize' && event.state === 'failed'
  const isMissingRequiredFieldEvent =
    event.scope === 'migrator' &&
    event.phase === 'prepare' &&
    event.state === 'warning' &&
    event.code === 'missing_required_field' &&
    event.category === 'source' &&
    event.migratorId === 'mcp_server'
  const isInvalidIdentifierEvent =
    event.scope === 'migrator' &&
    event.phase === 'execute' &&
    event.state === 'failed' &&
    event.code === 'invalid_identifier' &&
    event.category === 'source' &&
    event.migratorId === 'provider_model'

  const evidenceKind = event.semanticEvidence?.kind
  const rendererExportFailureEvidence =
    event.semanticEvidence?.kind === 'renderer_export_failure' ? event.semanticEvidence : undefined
  const evidenceMatchesEvent =
    (rendererExportFailureEvidence !== undefined &&
      isRendererExportFailureEvent &&
      isValidRendererExportFailureClassification(event, rendererExportFailureEvidence)) ||
    (evidenceKind === 'missing_required_field' && isMissingRequiredFieldEvent) ||
    (evidenceKind === 'invalid_identifier' && isInvalidIdentifierEvent)
  const fixedEventMatchesEvidence =
    (isRendererExportFailureEvent && evidenceKind === 'renderer_export_failure') ||
    (isMissingRequiredFieldEvent && evidenceKind === 'missing_required_field') ||
    (isInvalidIdentifierEvent && evidenceKind === 'invalid_identifier')

  if (
    (evidenceKind !== undefined && !evidenceMatchesEvent) ||
    ((isRendererExportFailureEvent || isMissingRequiredFieldEvent || isInvalidIdentifierEvent) &&
      !fixedEventMatchesEvidence)
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'Semantic evidence must appear together with its fixed diagnostic event',
      path: ['semanticEvidence']
    })
  }
}

export function createMigrationDiagnosticEventSchema<const T extends z.ZodRawShape>(recordFields: T) {
  return z
    .object({ ...recordFields, ...migrationDiagnosticEventFields })
    .strict()
    .superRefine((event, ctx) => validateMigrationDiagnosticEvent(event as MigrationDiagnosticEventCandidate, ctx))
}

export const migrationDiagnosticEventSchema = createMigrationDiagnosticEventSchema({
  sequence: z.number().int().nonnegative(),
  at: z.string().datetime(),
  attemptId: z.string().min(1).max(64),
  migratorId: migrationDiagnosticPersistedMigratorIdSchema.optional()
})

export const MIGRATION_DIAGNOSTICS_SESSION_VERSION = 2 as const
export const MIGRATION_DIAGNOSTICS_MAX_ATTEMPTS = 5
export const MIGRATION_DIAGNOSTICS_MAX_EVENTS = 200

export const migrationDiagnosticEventInputSchema = createMigrationDiagnosticEventSchema({
  migratorId: migrationDiagnosticMigratorIdSchema.optional()
})

export const migrationAttemptTriggerSchema = z.enum(['initial', 'manual_retry', 'recovered_retry'])
export const migrationAttemptTerminalOutcomeSchema = z.enum(['completed', 'failed', 'interrupted'])
export const migrationDiagnosticsPlatformSchema = z.enum(['darwin', 'win32', 'linux', 'other'])
export const migrationDiagnosticsArchSchema = z.enum(['x64', 'arm64', 'ia32', 'other'])

const migrationAttemptCommonFields = {
  id: z.string().min(1).max(64),
  trigger: migrationAttemptTriggerSchema,
  startedAt: z.string().datetime(),
  events: z.array(migrationDiagnosticEventSchema).max(MIGRATION_DIAGNOSTICS_MAX_EVENTS)
}

export const migrationDiagnosticsAttemptSchema = z
  .discriminatedUnion('outcome', [
    z
      .object({
        ...migrationAttemptCommonFields,
        outcome: z.literal('in_progress')
      })
      .strict(),
    z
      .object({
        ...migrationAttemptCommonFields,
        outcome: z.literal('completed'),
        endedAt: z.string().datetime()
      })
      .strict(),
    z
      .object({
        ...migrationAttemptCommonFields,
        outcome: z.literal('failed'),
        endedAt: z.string().datetime()
      })
      .strict(),
    z
      .object({
        ...migrationAttemptCommonFields,
        outcome: z.literal('interrupted'),
        endedAt: z.string().datetime()
      })
      .strict()
  ])
  .superRefine((attempt, ctx) => {
    let previousSequence = -1
    let previousEventTime = Date.parse(attempt.startedAt)
    for (const [index, event] of attempt.events.entries()) {
      if (event.attemptId !== attempt.id) {
        ctx.addIssue({
          code: 'custom',
          message: 'Event attempt ID must match its parent attempt',
          path: ['events', index, 'attemptId']
        })
      }
      if (event.sequence <= previousSequence) {
        ctx.addIssue({
          code: 'custom',
          message: 'Event sequences must be strictly increasing',
          path: ['events', index, 'sequence']
        })
      }
      const eventTime = Date.parse(event.at)
      if (eventTime < previousEventTime) {
        ctx.addIssue({
          code: 'custom',
          message: 'Event times must not move backwards',
          path: ['events', index, 'at']
        })
      }
      previousSequence = event.sequence
      previousEventTime = eventTime
    }

    if (attempt.outcome !== 'in_progress') {
      const lastEvent = attempt.events.at(-1)
      const lastEventAt = lastEvent?.at
      if (lastEvent?.state !== attempt.outcome) {
        ctx.addIssue({
          code: 'custom',
          message: 'Finished attempt must retain its matching terminal event',
          path: ['events']
        })
      }
      const endedAt = Date.parse(attempt.endedAt)
      if (endedAt < Date.parse(attempt.startedAt) || (lastEventAt !== undefined && endedAt < Date.parse(lastEventAt))) {
        ctx.addIssue({
          code: 'custom',
          message: 'Terminal attempt end time must include its recorded events',
          path: ['endedAt']
        })
      }
    }
  })

export const migrationDiagnosticsSessionSchema = z
  .object({
    version: z.literal(MIGRATION_DIAGNOSTICS_SESSION_VERSION),
    sessionId: z.string().min(1).max(64),
    appVersion: z.string().min(1).max(64),
    platform: migrationDiagnosticsPlatformSchema,
    arch: migrationDiagnosticsArchSchema,
    startedAt: z.string().datetime(),
    state: z.enum(['active', 'failed', 'completed']),
    attempts: z.array(migrationDiagnosticsAttemptSchema).max(MIGRATION_DIAGNOSTICS_MAX_ATTEMPTS)
  })
  .strict()
  .superRefine((session, ctx) => {
    const attemptIds = new Set<string>()
    let totalEvents = 0
    let previousSequence = -1
    let activeAttemptCount = 0

    for (const [attemptIndex, attempt] of session.attempts.entries()) {
      if (attemptIds.has(attempt.id)) {
        ctx.addIssue({ code: 'custom', message: 'Attempt IDs must be unique', path: ['attempts', attemptIndex, 'id'] })
      }
      attemptIds.add(attempt.id)
      if (Date.parse(attempt.startedAt) < Date.parse(session.startedAt)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Attempt time must not precede the session',
          path: ['attempts', attemptIndex, 'startedAt']
        })
      }
      if (attempt.outcome === 'in_progress') {
        activeAttemptCount += 1
        if (attemptIndex !== session.attempts.length - 1) {
          ctx.addIssue({
            code: 'custom',
            message: 'Only the newest attempt may be in progress',
            path: ['attempts', attemptIndex, 'outcome']
          })
        }
      }
      totalEvents += attempt.events.length
      for (const [eventIndex, event] of attempt.events.entries()) {
        if (event.sequence <= previousSequence) {
          ctx.addIssue({
            code: 'custom',
            message: 'Session event sequences must be strictly increasing',
            path: ['attempts', attemptIndex, 'events', eventIndex, 'sequence']
          })
        }
        previousSequence = event.sequence
      }
    }

    if (activeAttemptCount > 1) {
      ctx.addIssue({ code: 'custom', message: 'A session may have only one active attempt', path: ['attempts'] })
    }
    const newestAttempt = session.attempts.at(-1)
    if (session.state === 'completed' && newestAttempt !== undefined && newestAttempt.outcome !== 'completed') {
      ctx.addIssue({
        code: 'custom',
        message: 'Completed session must end with a completed attempt',
        path: ['attempts']
      })
    }
    if (session.state === 'failed' && newestAttempt?.outcome !== 'failed' && newestAttempt?.outcome !== 'interrupted') {
      ctx.addIssue({
        code: 'custom',
        message: 'Failed session must end with a failed or interrupted attempt',
        path: ['attempts']
      })
    }
    if (totalEvents > MIGRATION_DIAGNOSTICS_MAX_EVENTS) {
      ctx.addIssue({ code: 'custom', message: 'Session event retention limit exceeded', path: ['attempts'] })
    }
  })

export const MIGRATION_FAILURE_KINDS = [
  'upgrade_path_blocked',
  'preboot_failed',
  'renderer_export_failed',
  'source_prepare_failed',
  'migration_write_failed',
  'migration_invariant_failed',
  'migration_validation_failed',
  'migration_finalize_failed',
  'process_interrupted'
] as const

export const MIGRATION_FAILURE_ERROR_CODES = [
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
  'file_unknown',
  'source_read_failed',
  'source_parse_failed',
  'source_serialization_failed',
  'source_required_records_rejected',
  'source_invalid_identifier',
  'validation_count_mismatch',
  'validation_required_target_field',
  'validation_relation',
  'validation_material',
  'validation_vector',
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

export const MIGRATION_DIAGNOSTIC_WARNING_COUNT_BUCKETS = ['0', '1', '2-10', '11+'] as const

export const migrationFailureKindSchema = z.enum(MIGRATION_FAILURE_KINDS)
export const migrationFailureErrorCodeSchema = z.enum(MIGRATION_FAILURE_ERROR_CODES)
export const migrationDiagnosticWarningCountBucketSchema = z.enum(MIGRATION_DIAGNOSTIC_WARNING_COUNT_BUCKETS)

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
    sourceRole: z.enum(['mcp_server', 'assistant', 'mini_app']),
    fieldRole: z.enum(['source_id', 'required_name']),
    rejectedCountBucket: migrationDiagnosticWarningCountBucketSchema.exclude(['0'])
  })
  .strict()

export const MIGRATION_FAILED_WRITE_BYTE_LENGTH_BUCKETS = [
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
      .strict(),
    z
      .object({
        role: z.literal('blob_value'),
        kind: z.literal('blob'),
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
    operationRole: z.enum(['insert', 'update', 'upsert', 'import', 'status_write', 'temporary_index_write']),
    values: z.array(migrationFailedWriteValueMeasurementSchema).max(3)
  })
  .strict()

const migrationInvariantEvidenceSchema = z.union([
  z.object({ kind: z.literal('invariant'), invariantRole: z.literal('foreign_key') }).strict(),
  z
    .object({
      kind: z.literal('invariant'),
      invariantRole: z.literal('dependency'),
      dependencyRole: z.enum(['source_reference', 'target_reference'])
    })
    .strict(),
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
      expectedCountBucket: migrationDiagnosticWarningCountBucketSchema,
      actualCountBucket: migrationDiagnosticWarningCountBucketSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('validation'),
      checkRole: z.literal('required_target_field'),
      fieldRole: z.enum(['target_id', 'source_id', 'provider_id', 'model_id'])
    })
    .strict(),
  z.object({ kind: z.literal('validation'), checkRole: z.literal('relation') }).strict(),
  z.object({ kind: z.literal('validation'), checkRole: z.literal('material') }).strict(),
  z.object({ kind: z.literal('validation'), checkRole: z.literal('vector') }).strict(),
  z.object({ kind: z.literal('validation'), checkRole: z.literal('foreign_key') }).strict(),
  z.object({ kind: z.literal('validation'), checkRole: z.literal('status') }).strict()
])

const migrationInterruptionEvidenceSchema = z
  .object({
    kind: z.literal('interruption'),
    lastLocation: migrationDiagnosticLocationSchema,
    recoverySource: z.enum(['live_renderer_event', 'checkpoint'])
  })
  .strict()

export const migrationDiagnosticFailureEvidenceSchema = z.union([
  migrationVersionGateFailureEvidenceSchema,
  migrationRendererExportEvidenceSchema,
  migrationAllRequiredRowsRejectedEvidenceSchema,
  migrationFailedWriteEvidenceSchema,
  migrationInvariantEvidenceSchema,
  migrationValidationEvidenceSchema,
  migrationInterruptionEvidenceSchema
])

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
  'file_io',
  'file_unknown'
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
      errorCode: z.enum([
        'unknown_error',
        'path_resolution_failed',
        'legacy_data_location_unavailable',
        'data_location_pin_failed',
        'database_initialize_failed',
        'migration_status_probe_failed',
        'version_check_failed',
        'version_window_failed',
        'migration_window_failed'
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
        'file_io',
        'file_unknown'
      ]),
      evidence: migrationRendererExportEvidenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('source_prepare_failed'),
      scope: z.literal('migrator'),
      phase: z.literal('prepare'),
      migratorId: migrationDiagnosticMigratorIdSchema,
      errorCode: z.literal('source_required_records_rejected'),
      evidence: migrationAllRequiredRowsRejectedEvidenceSchema
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
      errorCode: z.enum([
        'unknown_error',
        'sqlite_constraint',
        'source_invalid_identifier',
        'validation_relation',
        'validation_foreign_key'
      ]),
      evidence: migrationInvariantEvidenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('migration_validation_failed'),
      scope: z.enum(['engine', 'migrator', 'database']),
      phase: z.literal('validate'),
      migratorId: migrationDiagnosticMigratorIdSchema.optional(),
      errorCode: z.enum([
        'unknown_error',
        'validation_count_mismatch',
        'validation_required_target_field',
        'validation_relation',
        'validation_material',
        'validation_vector',
        'validation_foreign_key'
      ]),
      evidence: migrationValidationEvidenceSchema
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
    endedAt: z.string().datetime(),
    warningCountBucket: migrationDiagnosticWarningCountBucketSchema
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

export type MigrationErrorCode = z.infer<typeof migrationErrorCodeSchema>
export type MigrationErrorCategory = z.infer<typeof migrationErrorCategorySchema>
export type PayloadProfileTarget = z.infer<typeof payloadProfileTargetSchema>
export type PayloadProfileSlot = z.infer<typeof payloadProfileSlotSchema>
export type LengthBucket = z.infer<typeof lengthBucketSchema>
export type RowCountBucket = z.infer<typeof rowCountBucketSchema>
export type PayloadTraversal = z.infer<typeof payloadTraversalSchema>
export type PayloadLengthSlotProfile = z.infer<typeof payloadLengthSlotProfileSchema>
export type PayloadLengthProfile = z.infer<typeof payloadLengthProfileSchema>
export type MigrationDiagnosticEvent = z.infer<typeof migrationDiagnosticEventSchema>
export type MigrationDiagnosticEventInput = z.infer<typeof migrationDiagnosticEventInputSchema>
export type MigrationDiagnosticMigratorId = z.infer<typeof migrationDiagnosticMigratorIdSchema>
export type MigrationDiagnosticPersistedMigratorId = z.infer<typeof migrationDiagnosticPersistedMigratorIdSchema>
export type MigrationDiagnosticSemanticEvidence = z.infer<typeof migrationDiagnosticSemanticEvidenceSchema>
export type MigrationDiagnosticDirectorySelectionRole = z.infer<typeof migrationDiagnosticDirectorySelectionRoleSchema>
export type MigrationDiagnosticVersionLogCountBucket = z.infer<typeof migrationDiagnosticVersionLogCountBucketSchema>
export type MigrationDiagnosticVersionLogContext = z.infer<typeof migrationDiagnosticVersionLogContextSchema>
export type MigrationVersionGateContext = z.infer<typeof migrationVersionGateContextSchema>
export type MigrationAttemptTrigger = z.infer<typeof migrationAttemptTriggerSchema>
export type MigrationAttemptTerminalOutcome = z.infer<typeof migrationAttemptTerminalOutcomeSchema>
export type MigrationDiagnosticsPlatform = z.infer<typeof migrationDiagnosticsPlatformSchema>
export type MigrationDiagnosticsArch = z.infer<typeof migrationDiagnosticsArchSchema>
export type MigrationDiagnosticsAttempt = z.infer<typeof migrationDiagnosticsAttemptSchema>
export type MigrationDiagnosticsSession = z.infer<typeof migrationDiagnosticsSessionSchema>
export type MigrationFailureKind = z.infer<typeof migrationFailureKindSchema>
export type MigrationFailureErrorCode = z.infer<typeof migrationFailureErrorCodeSchema>
export type MigrationDiagnosticLocation = z.infer<typeof migrationDiagnosticLocationSchema>
export type MigrationDiagnosticAppMetadata = z.infer<typeof migrationDiagnosticAppMetadataSchema>
export type MigrationDiagnosticFailure = z.infer<typeof migrationDiagnosticFailureSchema>
export type ProcessInterruptedFailure = Extract<MigrationDiagnosticFailure, { kind: 'process_interrupted' }>
export type MigrationDiagnosticFailureEvidence = NonNullable<MigrationDiagnosticFailure['evidence']>
export type MigrationDiagnosticAttempt = z.infer<typeof migrationDiagnosticAttemptSchema>
export type MigrationDiagnosticFinishedAttempt = z.infer<typeof migrationDiagnosticFinishedAttemptSchema>
export type MigrationAttemptFinish =
  | { status: 'completed'; warningCount: number }
  | { status: 'failed'; failure: MigrationDiagnosticFailure }
  | { status: 'interrupted'; failure: ProcessInterruptedFailure }
export type MigrationDiagnosticsSnapshot = Readonly<z.infer<typeof migrationDiagnosticsCheckpointSchema>>

export interface PayloadProfileDescriptor {
  readonly target: PayloadProfileTarget
  readonly fields: readonly PayloadProfileSlot[]
}
