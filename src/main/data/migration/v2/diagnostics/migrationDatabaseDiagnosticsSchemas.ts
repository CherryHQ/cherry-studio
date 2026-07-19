import * as z from 'zod'

import {
  EXPECTED_MIGRATION_DATABASE_OBJECTS,
  MIGRATION_DATABASE_DIAGNOSTIC_MAX_DATABASE_FILE_LENGTH,
  MIGRATION_DATABASE_DIAGNOSTIC_MAX_FOREIGN_KEY_GROUPS,
  MIGRATION_DATABASE_DIAGNOSTIC_MAX_FOREIGN_KEY_ROWS,
  MIGRATION_DATABASE_DIAGNOSTIC_QUICK_CHECK_RESULT_LIMIT,
  MIGRATION_DATABASE_DIAGNOSTIC_VERSION,
  MIGRATION_DATABASE_EXPECTED_SCHEMA_VERSION
} from './migrationDatabaseDiagnosticsProtocol.mjs'

export {
  EXPECTED_MIGRATION_DATABASE_OBJECTS,
  MIGRATION_DATABASE_DIAGNOSTIC_MAX_DATABASE_FILE_LENGTH,
  MIGRATION_DATABASE_DIAGNOSTIC_MAX_FOREIGN_KEY_GROUPS,
  MIGRATION_DATABASE_DIAGNOSTIC_MAX_FOREIGN_KEY_ROWS,
  MIGRATION_DATABASE_DIAGNOSTIC_MAX_MESSAGE_BYTES,
  MIGRATION_DATABASE_DIAGNOSTIC_MAX_SCHEMA_OBJECTS,
  MIGRATION_DATABASE_DIAGNOSTIC_MAX_SCHEMA_ROWS_SCANNED,
  MIGRATION_DATABASE_DIAGNOSTIC_QUICK_CHECK_RESULT_LIMIT,
  MIGRATION_DATABASE_DIAGNOSTIC_VERSION,
  MIGRATION_DATABASE_EXPECTED_SCHEMA_VERSION
} from './migrationDatabaseDiagnosticsProtocol.mjs'

const expectedObjectIds = EXPECTED_MIGRATION_DATABASE_OBJECTS.map((object) => object.id) as [string, ...string[]]

export const migrationDatabaseExpectedObjectIdSchema = z.enum(expectedObjectIds)
export const migrationDatabaseObjectKindSchema = z.enum(['table', 'index', 'trigger', 'view'])
export const migrationDatabaseUnknownObjectKindSchema = z.enum(['table', 'index', 'trigger', 'view', 'other'])
export const migrationDatabaseCountBucketSchema = z.enum([
  '0',
  '1',
  '2_to_5',
  '6_to_20',
  '21_to_100',
  '101_to_256',
  '257_plus'
])
export const migrationDatabaseColumnCountBucketSchema = z.enum([
  'unavailable',
  '0',
  '1_to_5',
  '6_to_10',
  '11_to_20',
  '21_to_40',
  '41_plus'
])

const countBucketBounds: Record<
  z.infer<typeof migrationDatabaseCountBucketSchema>,
  { readonly min: number; readonly max: number }
> = {
  '0': { min: 0, max: 0 },
  '1': { min: 1, max: 1 },
  '2_to_5': { min: 2, max: 5 },
  '6_to_20': { min: 6, max: 20 },
  '21_to_100': { min: 21, max: 100 },
  '101_to_256': { min: 101, max: 256 },
  '257_plus': { min: 257, max: Number.POSITIVE_INFINITY }
}

function bucketColumnCount(count: number): z.infer<typeof migrationDatabaseColumnCountBucketSchema> {
  if (count === 0) return '0'
  if (count <= 5) return '1_to_5'
  if (count <= 10) return '6_to_10'
  if (count <= 20) return '11_to_20'
  if (count <= 40) return '21_to_40'
  return '41_plus'
}

export const migrationDatabaseIntegerBucketSchema = z.enum(['0', '1_to_10', '11_to_100', '101_to_1000', '1001_plus'])
export const migrationDatabaseFailureCodeSchema = z.enum([
  'invalid_input',
  'permission_denied',
  'not_regular_file',
  'not_database',
  'wal_sidecars_unavailable',
  'read_failed',
  'open_failed',
  'query_failed'
])
export const migrationDatabaseCompletionFailureCodeSchema = z.enum([
  'invalid_input',
  'worker_error',
  'worker_exit',
  'worker_no_result',
  'protocol_error'
])

export const migrationDatabaseDiagnosticsWorkerInputSchema = z
  .object({
    databaseFile: z.string().min(1).max(MIGRATION_DATABASE_DIAGNOSTIC_MAX_DATABASE_FILE_LENGTH)
  })
  .strict()

export const migrationDatabaseL0DataSchema = z
  .object({
    exists: z.boolean(),
    fileKind: z.enum(['missing', 'regular', 'not_regular']),
    sizeBucket: z.enum([
      'unavailable',
      'empty',
      'under_4_kib',
      '4_kib_to_1_mib',
      '1_mib_to_16_mib',
      '16_mib_to_128_mib',
      '128_mib_to_1_gib',
      'over_1_gib'
    ]),
    mtimeAgeBucket: z.enum([
      'unavailable',
      'future',
      'under_1_hour',
      '1_to_24_hours',
      '1_to_7_days',
      '8_to_30_days',
      '31_to_365_days',
      'over_365_days'
    ]),
    header: z.enum(['unavailable', 'insufficient', 'valid', 'invalid']),
    writeMode: z.enum(['unavailable', 'rollback', 'wal', 'unknown']),
    walSidecars: z.enum(['none', 'complete', 'wal_only', 'shm_only', 'unsafe', 'unavailable'])
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.fileKind === 'missing') {
      if (data.exists) {
        ctx.addIssue({ code: 'custom', message: 'A missing database file cannot exist', path: ['exists'] })
      }
      for (const field of ['sizeBucket', 'mtimeAgeBucket', 'header', 'writeMode'] as const) {
        if (data[field] !== 'unavailable') {
          ctx.addIssue({ code: 'custom', message: 'Missing-file metadata must be unavailable', path: [field] })
        }
      }
      return
    }

    if (!data.exists) {
      ctx.addIssue({ code: 'custom', message: 'A present database file must exist', path: ['exists'] })
    }
    if (data.fileKind === 'regular') {
      if (data.sizeBucket === 'unavailable') {
        ctx.addIssue({
          code: 'custom',
          message: 'A regular database file must have a size bucket',
          path: ['sizeBucket']
        })
      }
      if (data.sizeBucket === 'empty' && data.header !== 'insufficient') {
        ctx.addIssue({
          code: 'custom',
          message: 'An empty regular file must have an insufficient SQLite header',
          path: ['header']
        })
      }
      if (data.header === 'valid' && data.writeMode === 'unavailable') {
        ctx.addIssue({
          code: 'custom',
          message: 'A valid SQLite header must expose its fixed write mode',
          path: ['writeMode']
        })
      }
      if (data.header !== 'valid' && data.writeMode !== 'unavailable') {
        ctx.addIssue({
          code: 'custom',
          message: 'An unreadable SQLite header cannot expose its write mode',
          path: ['writeMode']
        })
      }
      return
    }

    if (data.sizeBucket !== 'unavailable') {
      ctx.addIssue({
        code: 'custom',
        message: 'A non-regular file cannot expose a byte-size bucket',
        path: ['sizeBucket']
      })
    }
    if (data.header !== 'unavailable') {
      ctx.addIssue({
        code: 'custom',
        message: 'A non-regular file cannot expose a SQLite header result',
        path: ['header']
      })
    }
    if (data.writeMode !== 'unavailable') {
      ctx.addIssue({
        code: 'custom',
        message: 'A non-regular file cannot expose a SQLite write mode',
        path: ['writeMode']
      })
    }
  })

export const migrationDatabaseL1ObjectSchema = z
  .object({
    id: migrationDatabaseExpectedObjectIdSchema,
    kind: migrationDatabaseObjectKindSchema,
    status: z.enum(['ok', 'missing', 'type_mismatch', 'column_mismatch']),
    columnCountBucket: migrationDatabaseColumnCountBucketSchema
  })
  .strict()

export const migrationDatabaseL1DataSchema = z
  .object({
    metadata: z
      .object({
        pageSize: z.enum(['512', '1024', '2048', '4096', '8192', '16384', '32768', '65536', 'other']),
        encoding: z.enum(['utf8', 'utf16le', 'utf16be', 'other']),
        userVersionBucket: migrationDatabaseIntegerBucketSchema,
        schemaVersionBucket: migrationDatabaseIntegerBucketSchema,
        applicationId: z.enum(['unset', 'set']),
        queryOnly: z.literal(true)
      })
      .strict(),
    objects: z.array(migrationDatabaseL1ObjectSchema).length(EXPECTED_MIGRATION_DATABASE_OBJECTS.length),
    unknownObjects: z
      .array(
        z
          .object({
            kind: migrationDatabaseUnknownObjectKindSchema,
            countBucket: migrationDatabaseCountBucketSchema
          })
          .strict()
      )
      .max(5)
  })
  .strict()
  .superRefine((data, ctx) => {
    const definitionsById = new Map(EXPECTED_MIGRATION_DATABASE_OBJECTS.map((object) => [object.id, object]))
    const ids = new Set<string>()
    for (const [index, object] of data.objects.entries()) {
      if (ids.has(object.id)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Expected database object IDs must be unique',
          path: ['objects', index, 'id']
        })
      }
      ids.add(object.id)

      const definition = definitionsById.get(object.id)
      if (definition === undefined) continue
      if (object.kind !== definition.kind) {
        ctx.addIssue({
          code: 'custom',
          message: 'Expected database object kind does not match its fixed definition',
          path: ['objects', index, 'kind']
        })
      }

      const expectedColumnCount = 'columnCount' in definition ? definition.columnCount : undefined
      if (expectedColumnCount === undefined) {
        if (object.status === 'column_mismatch') {
          ctx.addIssue({
            code: 'custom',
            message: 'Objects without columns cannot have a column mismatch',
            path: ['objects', index, 'status']
          })
        }
        if (object.columnCountBucket !== 'unavailable') {
          ctx.addIssue({
            code: 'custom',
            message: 'Objects without columns cannot expose a column-count bucket',
            path: ['objects', index, 'columnCountBucket']
          })
        }
        continue
      }

      if (object.status === 'missing' || object.status === 'type_mismatch') {
        if (object.columnCountBucket !== 'unavailable') {
          ctx.addIssue({
            code: 'custom',
            message: 'Unavailable object columns must use the unavailable bucket',
            path: ['objects', index, 'columnCountBucket']
          })
        }
      } else if (object.columnCountBucket === 'unavailable') {
        ctx.addIssue({
          code: 'custom',
          message: 'Observed table columns require a count bucket',
          path: ['objects', index, 'columnCountBucket']
        })
      } else if (object.status === 'ok' && object.columnCountBucket !== bucketColumnCount(expectedColumnCount)) {
        ctx.addIssue({
          code: 'custom',
          message: 'An expected table with ok status must use its fixed column-count bucket',
          path: ['objects', index, 'columnCountBucket']
        })
      }
    }

    const unknownKinds = new Set<string>()
    for (const [index, object] of data.unknownObjects.entries()) {
      if (unknownKinds.has(object.kind)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Unknown database object kinds must be unique',
          path: ['unknownObjects', index, 'kind']
        })
      }
      unknownKinds.add(object.kind)
      if (object.countBucket === '0') {
        ctx.addIssue({
          code: 'custom',
          message: 'Unknown database object summaries cannot have a zero count',
          path: ['unknownObjects', index, 'countBucket']
        })
      }
    }
  })

export const migrationDatabaseL2DataSchema = z
  .object({
    quickCheck: z
      .object({
        outcome: z.enum(['ok', 'issues']),
        issueCountBucket: migrationDatabaseCountBucketSchema,
        categories: z.array(z.enum(['btree', 'freelist', 'page', 'index', 'encoding', 'constraint', 'unknown'])).max(7),
        truncated: z.boolean()
      })
      .strict(),
    foreignKeys: z
      .object({
        outcome: z.enum(['ok', 'violations']),
        scannedCountBucket: migrationDatabaseCountBucketSchema,
        violations: z
          .array(
            z
              .object({
                childObjectId: z.union([migrationDatabaseExpectedObjectIdSchema, z.literal('unknown')]),
                parentObjectId: z.union([migrationDatabaseExpectedObjectIdSchema, z.literal('unknown')]),
                countBucket: migrationDatabaseCountBucketSchema
              })
              .strict()
          )
          .max(MIGRATION_DATABASE_DIAGNOSTIC_MAX_FOREIGN_KEY_GROUPS),
        truncated: z.boolean()
      })
      .strict()
  })
  .strict()
  .superRefine((data, ctx) => {
    const quick = data.quickCheck
    if (quick.outcome === 'ok') {
      if (quick.issueCountBucket !== '0') {
        ctx.addIssue({
          code: 'custom',
          message: 'A successful quick check cannot report issues',
          path: ['quickCheck', 'issueCountBucket']
        })
      }
      if (quick.categories.length !== 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'A successful quick check cannot report categories',
          path: ['quickCheck', 'categories']
        })
      }
      if (quick.truncated) {
        ctx.addIssue({
          code: 'custom',
          message: 'A successful quick check cannot be truncated',
          path: ['quickCheck', 'truncated']
        })
      }
    } else {
      if (quick.issueCountBucket === '0') {
        ctx.addIssue({
          code: 'custom',
          message: 'Quick-check issues require a nonzero count',
          path: ['quickCheck', 'issueCountBucket']
        })
      }
      if (quick.categories.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Quick-check issues require a fixed category',
          path: ['quickCheck', 'categories']
        })
      }
      const quickCountBounds = countBucketBounds[quick.issueCountBucket]
      if (quickCountBounds.min > MIGRATION_DATABASE_DIAGNOSTIC_QUICK_CHECK_RESULT_LIMIT) {
        ctx.addIssue({
          code: 'custom',
          message: 'Quick-check issue count exceeds its fixed result limit',
          path: ['quickCheck', 'issueCountBucket']
        })
      }
      if (
        quick.truncated &&
        (quickCountBounds.min > MIGRATION_DATABASE_DIAGNOSTIC_QUICK_CHECK_RESULT_LIMIT ||
          quickCountBounds.max < MIGRATION_DATABASE_DIAGNOSTIC_QUICK_CHECK_RESULT_LIMIT)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'A truncated quick check must reach its fixed result limit',
          path: ['quickCheck', 'truncated']
        })
      }
    }
    if (new Set(quick.categories).size !== quick.categories.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Quick-check categories must be unique',
        path: ['quickCheck', 'categories']
      })
    }

    const foreignKeys = data.foreignKeys
    if (foreignKeys.outcome === 'ok') {
      if (foreignKeys.scannedCountBucket !== '0') {
        ctx.addIssue({
          code: 'custom',
          message: 'A successful foreign-key check cannot scan violations',
          path: ['foreignKeys', 'scannedCountBucket']
        })
      }
      if (foreignKeys.violations.length !== 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'A successful foreign-key check cannot report violations',
          path: ['foreignKeys', 'violations']
        })
      }
      if (foreignKeys.truncated) {
        ctx.addIssue({
          code: 'custom',
          message: 'A successful foreign-key check cannot be truncated',
          path: ['foreignKeys', 'truncated']
        })
      }
    } else {
      if (foreignKeys.scannedCountBucket === '0') {
        ctx.addIssue({
          code: 'custom',
          message: 'Foreign-key violations require a nonzero scanned count',
          path: ['foreignKeys', 'scannedCountBucket']
        })
      }
      if (foreignKeys.violations.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Foreign-key violations require a fixed summary group',
          path: ['foreignKeys', 'violations']
        })
      }
      const scannedCountBounds = countBucketBounds[foreignKeys.scannedCountBucket]
      if (scannedCountBounds.min > MIGRATION_DATABASE_DIAGNOSTIC_MAX_FOREIGN_KEY_ROWS) {
        ctx.addIssue({
          code: 'custom',
          message: 'Foreign-key scanned count exceeds its fixed row limit',
          path: ['foreignKeys', 'scannedCountBucket']
        })
      }
      if (foreignKeys.truncated && scannedCountBounds.max <= MIGRATION_DATABASE_DIAGNOSTIC_MAX_FOREIGN_KEY_GROUPS) {
        ctx.addIssue({
          code: 'custom',
          message: 'A truncated foreign-key check must reach a fixed truncation boundary',
          path: ['foreignKeys', 'truncated']
        })
      }
    }

    const pairs = new Set<string>()
    for (const [index, violation] of foreignKeys.violations.entries()) {
      const pair = `${violation.childObjectId}\0${violation.parentObjectId}`
      if (pairs.has(pair)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Foreign-key summary object pairs must be unique',
          path: ['foreignKeys', 'violations', index]
        })
      }
      pairs.add(pair)
      if (violation.countBucket === '0') {
        ctx.addIssue({
          code: 'custom',
          message: 'Foreign-key summary groups cannot have a zero count',
          path: ['foreignKeys', 'violations', index, 'countBucket']
        })
      }
      if (countBucketBounds[violation.countBucket].min > MIGRATION_DATABASE_DIAGNOSTIC_MAX_FOREIGN_KEY_ROWS) {
        ctx.addIssue({
          code: 'custom',
          message: 'Foreign-key summary group exceeds the fixed processed-row limit',
          path: ['foreignKeys', 'violations', index, 'countBucket']
        })
      }
    }
  })

function createStepSchema<TLevel extends 'l0' | 'l1' | 'l2', TData extends z.ZodType>(
  level: TLevel,
  dataSchema: TData
) {
  return z.union([
    z.object({ level: z.literal(level), status: z.literal('success'), data: dataSchema }).strict(),
    z.object({ level: z.literal(level), status: z.literal('truncated'), data: dataSchema }).strict(),
    z
      .object({
        level: z.literal(level),
        status: z.literal('failed'),
        code: migrationDatabaseFailureCodeSchema,
        data: dataSchema.optional()
      })
      .strict()
  ])
}

export const migrationDatabaseL0StepSchema = z.union([
  z.object({ level: z.literal('l0'), status: z.literal('success'), data: migrationDatabaseL0DataSchema }).strict(),
  z
    .object({
      level: z.literal('l0'),
      status: z.literal('failed'),
      code: migrationDatabaseFailureCodeSchema,
      data: migrationDatabaseL0DataSchema.optional()
    })
    .strict()
])
export const migrationDatabaseL1StepSchema = createStepSchema('l1', migrationDatabaseL1DataSchema)
export const migrationDatabaseL2StepSchema = createStepSchema('l2', migrationDatabaseL2DataSchema).superRefine(
  (step, ctx) => {
    if (step.status !== 'success' && step.status !== 'truncated') return
    const nestedTruncated = step.data.quickCheck.truncated || step.data.foreignKeys.truncated
    if (step.status === 'success' && nestedTruncated) {
      ctx.addIssue({
        code: 'custom',
        message: 'A successful L2 step cannot contain truncated checks',
        path: ['status']
      })
    }
    if (step.status === 'truncated' && !nestedTruncated) {
      ctx.addIssue({ code: 'custom', message: 'A truncated L2 step requires a truncated check', path: ['status'] })
    }
  }
)
export const migrationDatabaseDiagnosticStepSchema = z.union([
  migrationDatabaseL0StepSchema,
  migrationDatabaseL1StepSchema,
  migrationDatabaseL2StepSchema
])

export const migrationDatabaseCompletedDiagnosticResultSchema = z
  .object({
    version: z.literal(MIGRATION_DATABASE_DIAGNOSTIC_VERSION),
    expectedSchemaVersion: z.literal(MIGRATION_DATABASE_EXPECTED_SCHEMA_VERSION),
    completion: z.object({ status: z.literal('completed') }).strict(),
    l0: migrationDatabaseL0StepSchema,
    l1: migrationDatabaseL1StepSchema,
    l2: migrationDatabaseL2StepSchema
  })
  .strict()

const migrationDatabaseFailedDiagnosticResultSchema = z
  .object({
    version: z.literal(MIGRATION_DATABASE_DIAGNOSTIC_VERSION),
    expectedSchemaVersion: z.literal(MIGRATION_DATABASE_EXPECTED_SCHEMA_VERSION),
    completion: z.object({ status: z.literal('failed'), code: migrationDatabaseCompletionFailureCodeSchema }).strict(),
    l0: migrationDatabaseL0StepSchema.optional(),
    l1: migrationDatabaseL1StepSchema.optional(),
    l2: migrationDatabaseL2StepSchema.optional()
  })
  .strict()

const migrationDatabaseTimedOutDiagnosticResultSchema = z
  .object({
    version: z.literal(MIGRATION_DATABASE_DIAGNOSTIC_VERSION),
    expectedSchemaVersion: z.literal(MIGRATION_DATABASE_EXPECTED_SCHEMA_VERSION),
    completion: z.object({ status: z.literal('timed_out'), code: z.literal('worker_timeout') }).strict(),
    l0: migrationDatabaseL0StepSchema.optional(),
    l1: migrationDatabaseL1StepSchema.optional(),
    l2: migrationDatabaseL2StepSchema.optional()
  })
  .strict()

export const migrationDatabaseDiagnosticResultSchema = z
  .union([
    migrationDatabaseCompletedDiagnosticResultSchema,
    migrationDatabaseFailedDiagnosticResultSchema,
    migrationDatabaseTimedOutDiagnosticResultSchema
  ])
  .superRefine((result, ctx) => {
    if ('l2' in result && result.l2 !== undefined && (!('l1' in result) || result.l1 === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'L2 requires a completed L1 prefix', path: ['l2'] })
    }
    if ('l1' in result && result.l1 !== undefined && (!('l0' in result) || result.l0 === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'L1 requires a completed L0 prefix', path: ['l1'] })
    }
  })

export const migrationDatabaseDiagnosticsWorkerMessageSchema = z.union([
  z.object({ type: z.literal('step'), step: migrationDatabaseDiagnosticStepSchema }).strict(),
  z.object({ type: z.literal('result'), result: migrationDatabaseCompletedDiagnosticResultSchema }).strict()
])

export type MigrationDatabaseExpectedObjectId = z.infer<typeof migrationDatabaseExpectedObjectIdSchema>
export type MigrationDatabaseObjectKind = z.infer<typeof migrationDatabaseObjectKindSchema>
export type MigrationDatabaseUnknownObjectKind = z.infer<typeof migrationDatabaseUnknownObjectKindSchema>
export type MigrationDatabaseCountBucket = z.infer<typeof migrationDatabaseCountBucketSchema>
export type MigrationDatabaseColumnCountBucket = z.infer<typeof migrationDatabaseColumnCountBucketSchema>
export type MigrationDatabaseFailureCode = z.infer<typeof migrationDatabaseFailureCodeSchema>
export type MigrationDatabaseCompletionFailureCode = z.infer<typeof migrationDatabaseCompletionFailureCodeSchema>
export type MigrationDatabaseExpectedObjectDefinition = (typeof EXPECTED_MIGRATION_DATABASE_OBJECTS)[number]
export type MigrationDatabaseDiagnosticsWorkerInput = z.infer<typeof migrationDatabaseDiagnosticsWorkerInputSchema>
export type MigrationDatabaseL0Data = z.infer<typeof migrationDatabaseL0DataSchema>
export type MigrationDatabaseL1Data = z.infer<typeof migrationDatabaseL1DataSchema>
export type MigrationDatabaseL2Data = z.infer<typeof migrationDatabaseL2DataSchema>
export type MigrationDatabaseL0Step = z.infer<typeof migrationDatabaseL0StepSchema>
export type MigrationDatabaseL1Step = z.infer<typeof migrationDatabaseL1StepSchema>
export type MigrationDatabaseL2Step = z.infer<typeof migrationDatabaseL2StepSchema>
export type MigrationDatabaseDiagnosticStep = z.infer<typeof migrationDatabaseDiagnosticStepSchema>
export type MigrationDatabaseCompletedDiagnosticResult = z.infer<
  typeof migrationDatabaseCompletedDiagnosticResultSchema
>
export type MigrationDatabaseFailedDiagnosticResult = z.infer<typeof migrationDatabaseFailedDiagnosticResultSchema>
export type MigrationDatabaseTimedOutDiagnosticResult = z.infer<typeof migrationDatabaseTimedOutDiagnosticResultSchema>
export type MigrationDatabaseDiagnosticResult = z.infer<typeof migrationDatabaseDiagnosticResultSchema>
export type MigrationDatabaseDiagnosticsWorkerMessage = z.infer<typeof migrationDatabaseDiagnosticsWorkerMessageSchema>
