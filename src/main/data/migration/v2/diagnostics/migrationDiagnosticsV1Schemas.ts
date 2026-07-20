import * as z from 'zod'

import { type MigrationDiagnosticsSession, migrationDiagnosticsSessionSchema } from './migrationDiagnosticsSchemas'

/** Frozen producer IDs from the published V1 contract; future V2 additions must remain unknown to V1 upgrades. */
const MIGRATION_DIAGNOSTICS_V1_PRODUCER_MIGRATOR_IDS = Object.freeze([
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

const migrationDiagnosticsV1ErrorCodeSchema = z.enum([
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
])

const migrationDiagnosticsV1ErrorCategorySchema = z.enum([
  'filesystem',
  'database_read',
  'database_write',
  'source',
  'process',
  'archive',
  'unknown'
])

const migrationDiagnosticsV1PayloadTargetSchema = z.enum([
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
])

const migrationDiagnosticsV1PayloadSlotSchema = z.enum([
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
])

const migrationDiagnosticsV1LengthBucketSchema = z.enum([
  '0',
  '1-256',
  '257-4096',
  '4097-65536',
  '65537-262144',
  '262145+'
])
const migrationDiagnosticsV1RowCountBucketSchema = z.enum(['0', '1', '2-10', '11-100', '101-1000', '1001+'])
const migrationDiagnosticsV1PayloadTraversalSchema = z.enum(['complete', 'truncated'])

const migrationDiagnosticsV1PayloadSlotProfileSchema = z.discriminatedUnion('kind', [
  z
    .object({
      slot: migrationDiagnosticsV1PayloadSlotSchema,
      kind: z.literal('string'),
      totalByteLengthBucket: migrationDiagnosticsV1LengthBucketSchema,
      maxCharLengthBucket: migrationDiagnosticsV1LengthBucketSchema,
      maxByteLengthBucket: migrationDiagnosticsV1LengthBucketSchema
    })
    .strict(),
  z
    .object({
      slot: migrationDiagnosticsV1PayloadSlotSchema,
      kind: z.literal('bytes'),
      totalByteLengthBucket: migrationDiagnosticsV1LengthBucketSchema,
      maxByteLengthBucket: migrationDiagnosticsV1LengthBucketSchema
    })
    .strict(),
  z
    .object({
      slot: migrationDiagnosticsV1PayloadSlotSchema,
      kind: z.literal('json'),
      totalSerializedByteLengthBucket: migrationDiagnosticsV1LengthBucketSchema,
      maxSerializedByteLengthBucket: migrationDiagnosticsV1LengthBucketSchema,
      maxStringLeafCharLengthBucket: migrationDiagnosticsV1LengthBucketSchema,
      maxStringLeafByteLengthBucket: migrationDiagnosticsV1LengthBucketSchema,
      traversal: migrationDiagnosticsV1PayloadTraversalSchema
    })
    .strict(),
  z
    .object({
      slot: migrationDiagnosticsV1PayloadSlotSchema,
      kind: z.literal('mixed'),
      traversal: migrationDiagnosticsV1PayloadTraversalSchema
    })
    .strict(),
  z.object({ slot: migrationDiagnosticsV1PayloadSlotSchema, kind: z.literal('unsupported') }).strict(),
  z.object({ slot: migrationDiagnosticsV1PayloadSlotSchema, kind: z.literal('empty') }).strict()
])

const migrationDiagnosticsV1PayloadProfileSchema = z
  .object({
    target: migrationDiagnosticsV1PayloadTargetSchema,
    rowCountBucket: migrationDiagnosticsV1RowCountBucketSchema,
    profiledByteLengthBucket: migrationDiagnosticsV1LengthBucketSchema,
    maxProfiledRowByteLengthBucket: migrationDiagnosticsV1LengthBucketSchema,
    traversal: migrationDiagnosticsV1PayloadTraversalSchema,
    slots: z.array(migrationDiagnosticsV1PayloadSlotProfileSchema).max(64)
  })
  .strict()

const migrationDiagnosticsV1NormalizedVersionSchema = z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/)
const migrationDiagnosticsV1CurrentVersionSchema = z.union([
  z.literal('unknown'),
  migrationDiagnosticsV1NormalizedVersionSchema
])

const migrationDiagnosticsV1VersionGateSchema = z.discriminatedUnion('reason', [
  z
    .object({
      reason: z.literal('no_version_log'),
      currentVersion: migrationDiagnosticsV1CurrentVersionSchema,
      previousVersion: z.null(),
      requiredVersion: migrationDiagnosticsV1NormalizedVersionSchema,
      gatewayVersion: z.null(),
      versionLog: z.literal('missing')
    })
    .strict(),
  z
    .object({
      reason: z.literal('v1_too_old'),
      currentVersion: migrationDiagnosticsV1CurrentVersionSchema,
      previousVersion: migrationDiagnosticsV1NormalizedVersionSchema,
      requiredVersion: migrationDiagnosticsV1NormalizedVersionSchema,
      gatewayVersion: z.null(),
      versionLog: z.literal('present')
    })
    .strict(),
  z
    .object({
      reason: z.literal('v2_gateway_skipped'),
      currentVersion: migrationDiagnosticsV1CurrentVersionSchema,
      previousVersion: migrationDiagnosticsV1NormalizedVersionSchema,
      requiredVersion: z.null(),
      gatewayVersion: migrationDiagnosticsV1NormalizedVersionSchema,
      versionLog: z.literal('present')
    })
    .strict()
])

const migrationDiagnosticsV1EventSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    at: z.string().datetime(),
    attemptId: z.string().min(1).max(64),
    migratorId: z.string().max(64).optional(),
    scope: z.enum(['gate', 'renderer_export', 'engine', 'migrator', 'database', 'bundle']),
    phase: z.enum(['resolve_paths', 'initialize', 'prepare', 'execute', 'validate', 'finalize', 'save']),
    state: z.enum(['started', 'completed', 'failed', 'interrupted', 'unavailable']),
    code: migrationDiagnosticsV1ErrorCodeSchema,
    category: migrationDiagnosticsV1ErrorCategorySchema.optional(),
    causeDepth: z.number().int().min(0).max(4).optional(),
    payloadProfile: migrationDiagnosticsV1PayloadProfileSchema.optional(),
    versionGate: migrationDiagnosticsV1VersionGateSchema.optional()
  })
  .strict()
  .superRefine((event, ctx) => {
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
  })

const migrationDiagnosticsV1AttemptCommonFields = {
  id: z.string().min(1).max(64),
  trigger: z.enum(['initial', 'manual_retry', 'recovered_retry']),
  startedAt: z.string().datetime(),
  events: z.array(migrationDiagnosticsV1EventSchema).max(200)
}

const migrationDiagnosticsV1AttemptSchema = z
  .discriminatedUnion('outcome', [
    z.object({ ...migrationDiagnosticsV1AttemptCommonFields, outcome: z.literal('in_progress') }).strict(),
    z
      .object({
        ...migrationDiagnosticsV1AttemptCommonFields,
        outcome: z.literal('completed'),
        endedAt: z.string().datetime()
      })
      .strict(),
    z
      .object({
        ...migrationDiagnosticsV1AttemptCommonFields,
        outcome: z.literal('failed'),
        endedAt: z.string().datetime()
      })
      .strict(),
    z
      .object({
        ...migrationDiagnosticsV1AttemptCommonFields,
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
      if (lastEvent?.state !== attempt.outcome) {
        ctx.addIssue({
          code: 'custom',
          message: 'Finished attempt must retain its matching terminal event',
          path: ['events']
        })
      }
      const endedAt = Date.parse(attempt.endedAt)
      if (endedAt < Date.parse(attempt.startedAt) || (lastEvent !== undefined && endedAt < Date.parse(lastEvent.at))) {
        ctx.addIssue({
          code: 'custom',
          message: 'Terminal attempt end time must include its recorded events',
          path: ['endedAt']
        })
      }
    }
  })

export const migrationDiagnosticsV1SessionSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string().min(1).max(64),
    appVersion: z.string().min(1).max(64),
    platform: z.enum(['darwin', 'win32', 'linux', 'other']),
    arch: z.enum(['x64', 'arm64', 'ia32', 'other']),
    startedAt: z.string().datetime(),
    state: z.enum(['active', 'failed', 'completed']),
    attempts: z.array(migrationDiagnosticsV1AttemptSchema).max(5)
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
    if (totalEvents > 200) {
      ctx.addIssue({ code: 'custom', message: 'Session event retention limit exceeded', path: ['attempts'] })
    }
  })

export type MigrationDiagnosticsV1Session = z.infer<typeof migrationDiagnosticsV1SessionSchema>
type MigrationDiagnosticsV1Event = z.infer<typeof migrationDiagnosticsV1EventSchema>
type MigrationDiagnosticsV1PayloadProfile = z.infer<typeof migrationDiagnosticsV1PayloadProfileSchema>
type MigrationDiagnosticsV1PayloadSlotProfile = z.infer<typeof migrationDiagnosticsV1PayloadSlotProfileSchema>
type MigrationDiagnosticsV1VersionGate = z.infer<typeof migrationDiagnosticsV1VersionGateSchema>

const v1ProducerMigratorIds: ReadonlySet<string> = new Set(MIGRATION_DIAGNOSTICS_V1_PRODUCER_MIGRATOR_IDS)

function upgradePayloadSlot(slot: MigrationDiagnosticsV1PayloadSlotProfile) {
  switch (slot.kind) {
    case 'string':
      return {
        slot: slot.slot,
        kind: slot.kind,
        totalByteLengthBucket: slot.totalByteLengthBucket,
        maxCharLengthBucket: slot.maxCharLengthBucket,
        maxByteLengthBucket: slot.maxByteLengthBucket
      }
    case 'bytes':
      return {
        slot: slot.slot,
        kind: slot.kind,
        totalByteLengthBucket: slot.totalByteLengthBucket,
        maxByteLengthBucket: slot.maxByteLengthBucket
      }
    case 'json':
      return {
        slot: slot.slot,
        kind: slot.kind,
        totalSerializedByteLengthBucket: slot.totalSerializedByteLengthBucket,
        maxSerializedByteLengthBucket: slot.maxSerializedByteLengthBucket,
        maxStringLeafCharLengthBucket: slot.maxStringLeafCharLengthBucket,
        maxStringLeafByteLengthBucket: slot.maxStringLeafByteLengthBucket,
        traversal: slot.traversal
      }
    case 'mixed':
      return { slot: slot.slot, kind: slot.kind, traversal: slot.traversal }
    case 'unsupported':
    case 'empty':
      return { slot: slot.slot, kind: slot.kind }
  }
}

function upgradePayloadProfile(profile: MigrationDiagnosticsV1PayloadProfile) {
  return {
    target: profile.target,
    rowCountBucket: profile.rowCountBucket,
    profiledByteLengthBucket: profile.profiledByteLengthBucket,
    maxProfiledRowByteLengthBucket: profile.maxProfiledRowByteLengthBucket,
    traversal: profile.traversal,
    slots: profile.slots.map(upgradePayloadSlot)
  }
}

function upgradeVersionGate(versionGate: MigrationDiagnosticsV1VersionGate) {
  const versionLog =
    versionGate.versionLog === 'missing'
      ? ({ state: 'missing' } as const)
      : ({
          state: 'parsed',
          validRecordCountBucket: 'unknown',
          invalidRecordCountBucket: 'unknown'
        } as const)

  return {
    reason: versionGate.reason,
    currentVersion: versionGate.currentVersion,
    previousVersion: versionGate.previousVersion,
    requiredVersion: versionGate.requiredVersion,
    gatewayVersion: versionGate.gatewayVersion,
    directorySelectionRole: 'unknown' as const,
    versionLog
  }
}

function upgradeEvent(event: MigrationDiagnosticsV1Event): Record<string, unknown> {
  // V1 stored no renderer source/operation fact, while the V2 renderer-failure shape requires fixed evidence.
  const isRendererExportFailure =
    event.scope === 'renderer_export' && event.phase === 'finalize' && event.state === 'failed'
  const upgraded: Record<string, unknown> = {
    sequence: event.sequence,
    at: event.at,
    attemptId: event.attemptId,
    scope: event.scope,
    phase: event.phase,
    state: event.state,
    code: isRendererExportFailure ? 'unknown' : event.code
  }
  if (event.migratorId !== undefined) {
    upgraded.migratorId = v1ProducerMigratorIds.has(event.migratorId) ? event.migratorId : 'unknown'
  }
  if (isRendererExportFailure) {
    upgraded.category = 'unknown'
    upgraded.semanticEvidence = {
      kind: 'renderer_export_failure',
      sourceRole: 'unknown',
      operationRole: 'unknown'
    }
  } else if (event.category !== undefined) {
    upgraded.category = event.category
  }
  if (!isRendererExportFailure && event.causeDepth !== undefined) {
    upgraded.causeDepth = event.causeDepth
  }
  if (event.payloadProfile !== undefined) {
    upgraded.payloadProfile = upgradePayloadProfile(event.payloadProfile)
  }
  if (event.versionGate !== undefined) {
    upgraded.versionGate = upgradeVersionGate(event.versionGate)
  }
  return upgraded
}

export function upgradeMigrationDiagnosticsV1Session(
  session: MigrationDiagnosticsV1Session
): MigrationDiagnosticsSession {
  const attempts = session.attempts.map((attempt) => {
    const upgraded: Record<string, unknown> = {
      id: attempt.id,
      trigger: attempt.trigger,
      startedAt: attempt.startedAt,
      outcome: attempt.outcome,
      events: attempt.events.map(upgradeEvent)
    }
    if (attempt.outcome !== 'in_progress') {
      upgraded.endedAt = attempt.endedAt
    }
    return upgraded
  })

  return migrationDiagnosticsSessionSchema.parse({
    version: 2,
    sessionId: session.sessionId,
    appVersion: session.appVersion,
    platform: session.platform,
    arch: session.arch,
    startedAt: session.startedAt,
    state: session.state,
    attempts
  })
}
