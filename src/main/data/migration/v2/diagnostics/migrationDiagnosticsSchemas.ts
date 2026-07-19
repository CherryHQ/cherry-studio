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
  'worker_timeout',
  'archive_write'
] as const

export const MIGRATION_ERROR_CATEGORIES = [
  'filesystem',
  'database_read',
  'database_write',
  'source',
  'worker',
  'archive',
  'unknown'
] as const

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
  'agent_relation',
  'knowledge_vector_status'
] as const

export const PAYLOAD_PROFILE_SLOTS = [
  'value',
  'name',
  'prompt',
  'description',
  'command',
  'args',
  'env',
  'apiHost',
  'apiKey',
  'config',
  'url',
  'logo',
  'path',
  'metadata',
  'content',
  'negativePrompt',
  'sourceText',
  'targetText',
  'title',
  'error'
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

export const migrationDiagnosticEventSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    at: z.string().datetime(),
    attemptId: z.string().min(1).max(64),
    scope: z.enum(['gate', 'renderer_export', 'engine', 'migrator', 'database', 'bundle']),
    phase: z.enum(['resolve_paths', 'initialize', 'prepare', 'execute', 'validate', 'finalize', 'save']),
    state: z.enum(['started', 'completed', 'failed', 'interrupted', 'unavailable']),
    code: migrationErrorCodeSchema,
    migratorId: z.string().min(1).max(64).optional(),
    payloadProfile: payloadLengthProfileSchema.optional()
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

export interface PayloadProfileDescriptor {
  readonly target: PayloadProfileTarget
  readonly fields: readonly PayloadProfileSlot[]
}
