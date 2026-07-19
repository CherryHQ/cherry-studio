import * as z from 'zod'

import {
  MIGRATION_DATABASE_DIAGNOSTIC_VERSION,
  MIGRATION_DATABASE_EXPECTED_SCHEMA_VERSION,
  migrationDatabaseCompletionFailureCodeSchema,
  migrationDatabaseFailureCodeSchema,
  migrationDatabaseL0DataSchema,
  migrationDatabaseL1DataSchema,
  migrationDatabaseL2DataSchema
} from './migrationDatabaseDiagnosticsSchemas'
import {
  createMigrationDiagnosticEventSchema,
  MIGRATION_DIAGNOSTIC_MIGRATOR_IDS,
  MIGRATION_DIAGNOSTICS_MAX_ATTEMPTS,
  MIGRATION_DIAGNOSTICS_MAX_EVENTS,
  migrationAttemptTriggerSchema,
  migrationDiagnosticsArchSchema,
  migrationDiagnosticsPlatformSchema
} from './migrationDiagnosticsSchemas'

export const MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES = 1_048_576
export const MIGRATION_DIAGNOSTIC_STRICT_ENTRIES = Object.freeze([
  'manifest.json',
  'migration-events.json',
  'database-diagnostics.json',
  'README.txt'
] as const)

export const migrationDiagnosticStrictEntryNameSchema = z.enum(MIGRATION_DIAGNOSTIC_STRICT_ENTRIES)
export const migrationDiagnosticSafeAppVersionSchema = z.union([
  z.literal('unknown'),
  z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/)
])
export const migrationDiagnosticSafeMigratorIdSchema = z.enum([...MIGRATION_DIAGNOSTIC_MIGRATOR_IDS, 'unknown'])

const MIGRATION_DIAGNOSTIC_BUNDLE_ATTEMPT_IDS = Object.freeze(
  Array.from({ length: MIGRATION_DIAGNOSTICS_MAX_ATTEMPTS }, (_, index) => `attempt-${index + 1}`)
)
const migrationDiagnosticBundleAttemptIdSchema = z
  .string()
  .refine(
    (value) => MIGRATION_DIAGNOSTIC_BUNDLE_ATTEMPT_IDS.includes(value),
    'Attempt ID must use a bounded generated ordinal'
  )

export const migrationDiagnosticBundleEventSchema = createMigrationDiagnosticEventSchema({
  sequence: z.number().int().nonnegative(),
  at: z.string().datetime(),
  migratorId: migrationDiagnosticSafeMigratorIdSchema.optional()
})

const attemptCommonFields = {
  id: migrationDiagnosticBundleAttemptIdSchema,
  trigger: migrationAttemptTriggerSchema,
  startedAt: z.string().datetime(),
  events: z.array(migrationDiagnosticBundleEventSchema).max(MIGRATION_DIAGNOSTICS_MAX_EVENTS)
}

export const migrationDiagnosticBundleAttemptSchema = z
  .discriminatedUnion('outcome', [
    z.object({ ...attemptCommonFields, outcome: z.literal('in_progress') }).strict(),
    z
      .object({
        ...attemptCommonFields,
        outcome: z.literal('completed'),
        endedAt: z.string().datetime()
      })
      .strict(),
    z.object({ ...attemptCommonFields, outcome: z.literal('failed'), endedAt: z.string().datetime() }).strict(),
    z
      .object({
        ...attemptCommonFields,
        outcome: z.literal('interrupted'),
        endedAt: z.string().datetime()
      })
      .strict()
  ])
  .superRefine((attempt, ctx) => {
    let previousSequence = -1
    let previousTime = Date.parse(attempt.startedAt)
    for (const [index, event] of attempt.events.entries()) {
      const eventTime = Date.parse(event.at)
      if (event.sequence <= previousSequence) {
        ctx.addIssue({ code: 'custom', message: 'Event sequences must increase', path: ['events', index, 'sequence'] })
      }
      if (eventTime < previousTime) {
        ctx.addIssue({ code: 'custom', message: 'Event times must not move backwards', path: ['events', index, 'at'] })
      }
      previousSequence = event.sequence
      previousTime = eventTime
    }

    if (attempt.outcome === 'in_progress') return
    const terminal = attempt.events.at(-1)
    if (terminal === undefined || terminal.state !== attempt.outcome || terminal.at !== attempt.endedAt) {
      ctx.addIssue({
        code: 'custom',
        message: 'Finished attempt requires its explicit terminal event',
        path: ['events']
      })
      return
    }
    if (attempt.outcome === 'completed' && terminal.code !== 'unknown') {
      ctx.addIssue({
        code: 'custom',
        message: 'Completed terminal events cannot report an error code',
        path: ['events']
      })
    }
    if (attempt.outcome === 'interrupted' && terminal.code !== 'unknown' && terminal.code !== 'process_timeout') {
      ctx.addIssue({
        code: 'custom',
        message: 'Interrupted terminal events use a fixed interruption code',
        path: ['events']
      })
    }
  })

export const migrationDiagnosticEventsDocumentSchema = z
  .object({
    formatVersion: z.literal(1),
    session: z
      .object({
        appVersion: migrationDiagnosticSafeAppVersionSchema,
        platform: migrationDiagnosticsPlatformSchema,
        arch: migrationDiagnosticsArchSchema,
        startedAt: z.string().datetime(),
        state: z.enum(['active', 'failed', 'completed'])
      })
      .strict(),
    attempts: z.array(migrationDiagnosticBundleAttemptSchema).max(MIGRATION_DIAGNOSTICS_MAX_ATTEMPTS)
  })
  .strict()
  .superRefine((document, ctx) => {
    let previousSequence = -1
    let activeAttempts = 0
    for (const [attemptIndex, attempt] of document.attempts.entries()) {
      if (attempt.id !== MIGRATION_DIAGNOSTIC_BUNDLE_ATTEMPT_IDS[attemptIndex]) {
        ctx.addIssue({
          code: 'custom',
          message: 'Attempt IDs must match their exact ordered ordinals',
          path: ['attempts', attemptIndex, 'id']
        })
      }
      if (Date.parse(attempt.startedAt) < Date.parse(document.session.startedAt)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Attempt cannot predate its session',
          path: ['attempts', attemptIndex]
        })
      }
      if (attempt.outcome === 'in_progress') activeAttempts += 1
      for (const [eventIndex, event] of attempt.events.entries()) {
        if (event.sequence <= previousSequence) {
          ctx.addIssue({
            code: 'custom',
            message: 'Session event sequences must increase',
            path: ['attempts', attemptIndex, 'events', eventIndex, 'sequence']
          })
        }
        previousSequence = event.sequence
      }
    }
    if (activeAttempts > 1) {
      ctx.addIssue({ code: 'custom', message: 'Only one attempt may be active', path: ['attempts'] })
    }
    const newest = document.attempts.at(-1)
    if (document.session.state === 'completed' && newest !== undefined && newest.outcome !== 'completed') {
      ctx.addIssue({ code: 'custom', message: 'Completed sessions require a completed attempt', path: ['attempts'] })
    }
    if (document.session.state === 'failed' && newest?.outcome !== 'failed' && newest?.outcome !== 'interrupted') {
      ctx.addIssue({ code: 'custom', message: 'Failed sessions require a failed attempt', path: ['attempts'] })
    }
  })

const databaseCompletionSchema = z.union([
  z.object({ status: z.literal('completed') }).strict(),
  z.object({ status: z.literal('failed'), code: migrationDatabaseCompletionFailureCodeSchema }).strict(),
  z.object({ status: z.literal('timed_out'), code: z.literal('process_timeout') }).strict()
])

function databaseDetailsSchema<TData extends z.ZodType>(dataSchema: TData) {
  return z.discriminatedUnion('status', [
    z.object({ status: z.literal('included'), data: dataSchema }).strict(),
    z.object({ status: z.literal('unavailable') }).strict(),
    z.object({ status: z.literal('omitted_for_size') }).strict()
  ])
}

function databaseLevelSchema<TLevel extends 'l0' | 'l1' | 'l2', TData extends z.ZodType>(
  level: TLevel,
  dataSchema: TData,
  allowTruncated: boolean
) {
  const statusSchema = allowTruncated ? z.enum(['success', 'truncated']) : z.literal('success')
  return z
    .union([
      z.object({ level: z.literal(level), status: statusSchema, details: databaseDetailsSchema(dataSchema) }).strict(),
      z
        .object({
          level: z.literal(level),
          status: z.literal('failed'),
          code: migrationDatabaseFailureCodeSchema,
          details: databaseDetailsSchema(dataSchema)
        })
        .strict()
    ])
    .superRefine((step, ctx) => {
      if (step.status !== 'failed' && step.details.status === 'unavailable') {
        ctx.addIssue({
          code: 'custom',
          message: 'Successful database levels cannot have unavailable details',
          path: ['details']
        })
      }
    })
}

export const migrationDatabaseDiagnosticL0DocumentStepSchema = databaseLevelSchema(
  'l0',
  migrationDatabaseL0DataSchema,
  false
)
export const migrationDatabaseDiagnosticL1DocumentStepSchema = databaseLevelSchema(
  'l1',
  migrationDatabaseL1DataSchema,
  true
)
export const migrationDatabaseDiagnosticL2DocumentStepSchema = databaseLevelSchema(
  'l2',
  migrationDatabaseL2DataSchema,
  true
)

export const migrationDatabaseDiagnosticsDocumentSchema = z
  .object({
    formatVersion: z.literal(1),
    diagnosticVersion: z.literal(MIGRATION_DATABASE_DIAGNOSTIC_VERSION),
    expectedSchemaVersion: z.literal(MIGRATION_DATABASE_EXPECTED_SCHEMA_VERSION),
    completion: databaseCompletionSchema,
    levels: z
      .object({
        l0: migrationDatabaseDiagnosticL0DocumentStepSchema.optional(),
        l1: migrationDatabaseDiagnosticL1DocumentStepSchema.optional(),
        l2: migrationDatabaseDiagnosticL2DocumentStepSchema.optional()
      })
      .strict()
  })
  .strict()
  .superRefine((document, ctx) => {
    if (document.levels.l2 !== undefined && document.levels.l1 === undefined) {
      ctx.addIssue({ code: 'custom', message: 'L2 requires L1', path: ['levels', 'l2'] })
    }
    if (document.levels.l1 !== undefined && document.levels.l0 === undefined) {
      ctx.addIssue({ code: 'custom', message: 'L1 requires L0', path: ['levels', 'l1'] })
    }
    if (
      document.completion.status === 'completed' &&
      (document.levels.l0 === undefined || document.levels.l1 === undefined || document.levels.l2 === undefined)
    ) {
      ctx.addIssue({ code: 'custom', message: 'Completed diagnostics require all levels', path: ['levels'] })
    }
  })

const manifestAttemptSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      id: migrationDiagnosticBundleAttemptIdSchema,
      trigger: migrationAttemptTriggerSchema,
      startedAt: z.string().datetime(),
      outcome: z.literal('in_progress')
    })
    .strict(),
  z
    .object({
      id: migrationDiagnosticBundleAttemptIdSchema,
      trigger: migrationAttemptTriggerSchema,
      startedAt: z.string().datetime(),
      outcome: z.enum(['completed', 'failed', 'interrupted']),
      endedAt: z.string().datetime()
    })
    .strict()
])

const manifestEntrySchema = z
  .object({
    name: migrationDiagnosticStrictEntryNameSchema,
    uncompressedBytes: z.number().int().nonnegative().max(MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES)
  })
  .strict()

export const migrationDiagnosticManifestSchema = z
  .object({
    formatVersion: z.literal(1),
    policy: z.literal('strict'),
    session: z
      .object({
        appVersion: migrationDiagnosticSafeAppVersionSchema,
        platform: migrationDiagnosticsPlatformSchema,
        arch: migrationDiagnosticsArchSchema,
        startedAt: z.string().datetime(),
        state: z.enum(['active', 'failed', 'completed']),
        attempts: z.array(manifestAttemptSchema).max(MIGRATION_DIAGNOSTICS_MAX_ATTEMPTS)
      })
      .strict(),
    components: z
      .object({
        migrationEvents: z.object({ status: z.enum(['complete', 'truncated']) }).strict(),
        databaseDiagnostics: z
          .object({
            status: z.enum(['complete', 'partial', 'unavailable']),
            details: z.enum(['complete', 'truncated'])
          })
          .strict()
      })
      .strict(),
    truncation: z
      .object({
        droppedIntermediateEvents: z.number().int().nonnegative().max(MIGRATION_DIAGNOSTICS_MAX_EVENTS),
        omittedDatabaseDetails: z.array(z.enum(['l2', 'l1', 'l0'])).max(3)
      })
      .strict(),
    entries: z.array(manifestEntrySchema).length(MIGRATION_DIAGNOSTIC_STRICT_ENTRIES.length),
    totalUncompressedBytes: z.number().int().nonnegative().max(MIGRATION_DIAGNOSTIC_STRICT_LIMIT_BYTES)
  })
  .strict()
  .superRefine((manifest, ctx) => {
    for (const [attemptIndex, attempt] of manifest.session.attempts.entries()) {
      if (attempt.id !== MIGRATION_DIAGNOSTIC_BUNDLE_ATTEMPT_IDS[attemptIndex]) {
        ctx.addIssue({
          code: 'custom',
          message: 'Manifest attempt IDs must match their exact ordered ordinals',
          path: ['session', 'attempts', attemptIndex, 'id']
        })
      }
    }
    for (const [index, expected] of MIGRATION_DIAGNOSTIC_STRICT_ENTRIES.entries()) {
      if (manifest.entries[index]?.name !== expected) {
        ctx.addIssue({ code: 'custom', message: 'Manifest entries must use the fixed order', path: ['entries', index] })
      }
    }
    if (
      new Set(manifest.truncation.omittedDatabaseDetails).size !== manifest.truncation.omittedDatabaseDetails.length
    ) {
      ctx.addIssue({ code: 'custom', message: 'Omitted database levels must be unique', path: ['truncation'] })
    }
    let previousOmissionIndex = -1
    for (const level of manifest.truncation.omittedDatabaseDetails) {
      const omissionIndex = ['l2', 'l1', 'l0'].indexOf(level)
      if (omissionIndex <= previousOmissionIndex) {
        ctx.addIssue({ code: 'custom', message: 'Database details use a fixed omission order', path: ['truncation'] })
        break
      }
      previousOmissionIndex = omissionIndex
    }
    const hasDroppedEvents = manifest.truncation.droppedIntermediateEvents > 0
    if ((manifest.components.migrationEvents.status === 'truncated') !== hasDroppedEvents) {
      ctx.addIssue({
        code: 'custom',
        message: 'Migration event status must agree with the dropped event count',
        path: ['components', 'migrationEvents', 'status']
      })
    }
    const hasOmittedDatabaseDetails = manifest.truncation.omittedDatabaseDetails.length > 0
    if ((manifest.components.databaseDiagnostics.details === 'truncated') !== hasOmittedDatabaseDetails) {
      ctx.addIssue({
        code: 'custom',
        message: 'Database detail status must agree with the omission list',
        path: ['components', 'databaseDiagnostics', 'details']
      })
    }
    const sum = manifest.entries.reduce((total, entry) => total + entry.uncompressedBytes, 0)
    if (sum !== manifest.totalUncompressedBytes) {
      ctx.addIssue({
        code: 'custom',
        message: 'Manifest total must equal its entry byte counts',
        path: ['totalUncompressedBytes']
      })
    }
  })

export type MigrationDiagnosticEventsDocument = z.infer<typeof migrationDiagnosticEventsDocumentSchema>
export type MigrationDiagnosticBundleAttempt = z.infer<typeof migrationDiagnosticBundleAttemptSchema>
export type MigrationDiagnosticBundleEvent = z.infer<typeof migrationDiagnosticBundleEventSchema>
export type MigrationDatabaseDiagnosticsDocument = z.infer<typeof migrationDatabaseDiagnosticsDocumentSchema>
export type MigrationDatabaseDiagnosticDocumentLevel = keyof MigrationDatabaseDiagnosticsDocument['levels']
export type MigrationDiagnosticManifest = z.infer<typeof migrationDiagnosticManifestSchema>
export type MigrationDiagnosticStrictEntryName = z.infer<typeof migrationDiagnosticStrictEntryNameSchema>
