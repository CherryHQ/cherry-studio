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

export const migrationVersionGateContextSchema = z.discriminatedUnion('reason', [
  z
    .object({
      reason: z.literal('no_version_log'),
      currentVersion: migrationDiagnosticCurrentVersionSchema,
      previousVersion: z.null(),
      requiredVersion: migrationDiagnosticNormalizedVersionSchema,
      gatewayVersion: z.null(),
      versionLog: z.literal('missing')
    })
    .strict(),
  z
    .object({
      reason: z.literal('v1_too_old'),
      currentVersion: migrationDiagnosticCurrentVersionSchema,
      previousVersion: migrationDiagnosticNormalizedVersionSchema,
      requiredVersion: migrationDiagnosticNormalizedVersionSchema,
      gatewayVersion: z.null(),
      versionLog: z.literal('present')
    })
    .strict(),
  z
    .object({
      reason: z.literal('v2_gateway_skipped'),
      currentVersion: migrationDiagnosticCurrentVersionSchema,
      previousVersion: migrationDiagnosticNormalizedVersionSchema,
      requiredVersion: z.null(),
      gatewayVersion: migrationDiagnosticNormalizedVersionSchema,
      versionLog: z.literal('present')
    })
    .strict()
])

const migrationDiagnosticEventFields = {
  scope: z.enum(['gate', 'renderer_export', 'engine', 'migrator', 'database', 'bundle']),
  phase: z.enum(['resolve_paths', 'initialize', 'prepare', 'execute', 'validate', 'finalize', 'save']),
  state: z.enum(['started', 'completed', 'failed', 'interrupted', 'unavailable']),
  code: migrationErrorCodeSchema,
  category: migrationErrorCategorySchema.optional(),
  causeDepth: z.number().int().min(0).max(4).optional(),
  payloadProfile: payloadLengthProfileSchema.optional(),
  versionGate: migrationVersionGateContextSchema.optional()
}

interface MigrationDiagnosticVersionGateEventCandidate {
  readonly scope?: unknown
  readonly phase?: unknown
  readonly state?: unknown
  readonly code?: unknown
  readonly versionGate?: unknown
}

function validateMigrationDiagnosticVersionGateEvent(
  event: MigrationDiagnosticVersionGateEventCandidate,
  ctx: z.RefinementCtx
): void {
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
}

export function createMigrationDiagnosticEventSchema<const T extends z.ZodRawShape>(recordFields: T) {
  return z
    .object({ ...recordFields, ...migrationDiagnosticEventFields })
    .strict()
    .superRefine(validateMigrationDiagnosticVersionGateEvent)
}

export const migrationDiagnosticEventSchema = createMigrationDiagnosticEventSchema({
  sequence: z.number().int().nonnegative(),
  at: z.string().datetime(),
  attemptId: z.string().min(1).max(64),
  migratorId: z.string().max(64).optional()
})

export const MIGRATION_DIAGNOSTICS_SESSION_VERSION = 1 as const
export const MIGRATION_DIAGNOSTICS_MAX_ATTEMPTS = 5
export const MIGRATION_DIAGNOSTICS_MAX_EVENTS = 200

export const migrationDiagnosticEventInputSchema = createMigrationDiagnosticEventSchema({
  migratorId: z.string().max(64).optional()
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
export type MigrationVersionGateContext = z.infer<typeof migrationVersionGateContextSchema>
export type MigrationAttemptTrigger = z.infer<typeof migrationAttemptTriggerSchema>
export type MigrationAttemptTerminalOutcome = z.infer<typeof migrationAttemptTerminalOutcomeSchema>
export type MigrationDiagnosticsPlatform = z.infer<typeof migrationDiagnosticsPlatformSchema>
export type MigrationDiagnosticsArch = z.infer<typeof migrationDiagnosticsArchSchema>
export type MigrationDiagnosticsAttempt = z.infer<typeof migrationDiagnosticsAttemptSchema>
export type MigrationDiagnosticsSession = z.infer<typeof migrationDiagnosticsSessionSchema>

export interface PayloadProfileDescriptor {
  readonly target: PayloadProfileTarget
  readonly fields: readonly PayloadProfileSlot[]
}
