import * as z from 'zod'

export const MIGRATION_DATABASE_DIAGNOSTIC_VERSION = 1 as const
export const MIGRATION_DATABASE_EXPECTED_SCHEMA_VERSION = 1 as const
export const MIGRATION_DATABASE_DIAGNOSTIC_MAX_MESSAGE_BYTES = 65_536
export const MIGRATION_DATABASE_DIAGNOSTIC_MAX_SCHEMA_OBJECTS = 160
export const MIGRATION_DATABASE_DIAGNOSTIC_MAX_FOREIGN_KEY_ROWS = 256
export const MIGRATION_DATABASE_DIAGNOSTIC_MAX_FOREIGN_KEY_GROUPS = 64

/**
 * Version 1 of the complete expected SQLite schema surface.
 *
 * This is deliberately a checked-in allowlist. Runtime sqlite_schema rows are
 * compared with it, never added to it. SQLite-owned `sqlite_%` objects are the
 * only excluded names. FTS virtual and shadow tables are included explicitly so
 * a healthy production database has no unexplained unknown-object baseline.
 */
export const EXPECTED_MIGRATION_DATABASE_OBJECTS = [
  { id: 'agent_channel_agent_id_idx', kind: 'index' },
  { id: 'agent_channel_session_id_idx', kind: 'index' },
  { id: 'agent_channel_task_channel_id_idx', kind: 'index' },
  { id: 'agent_channel_task_task_id_idx', kind: 'index' },
  { id: 'agent_channel_type_idx', kind: 'index' },
  { id: 'agent_global_skill_folder_name_unique', kind: 'index' },
  { id: 'agent_global_skill_is_enabled_idx', kind: 'index' },
  { id: 'agent_global_skill_source_idx', kind: 'index' },
  { id: 'agent_name_idx', kind: 'index' },
  { id: 'agent_order_key_idx', kind: 'index' },
  {
    id: 'agent_session_message_fts_identity_unique_index',
    name: 'agent_session_message_fts_rowid_uniq',
    kind: 'index'
  },
  { id: 'agent_session_message_session_created_id_idx', kind: 'index' },
  { id: 'agent_session_message_status_idx', kind: 'index' },
  { id: 'agent_session_order_key_idx', kind: 'index' },
  { id: 'agent_session_updated_at_idx', kind: 'index' },
  { id: 'agent_skill_agent_id_idx', kind: 'index' },
  { id: 'agent_skill_skill_id_idx', kind: 'index' },
  { id: 'agent_type_idx', kind: 'index' },
  { id: 'agent_workspace_order_key_idx', kind: 'index' },
  { id: 'agent_workspace_path_unique_idx', kind: 'index' },
  { id: 'assistant_created_at_idx', kind: 'index' },
  { id: 'assistant_order_key_idx', kind: 'index' },
  { id: 'cmfr_entry_id_idx', kind: 'index' },
  { id: 'cmfr_source_id_idx', kind: 'index' },
  { id: 'cmfr_unique_idx', kind: 'index' },
  { id: 'entity_tag_tag_id_idx', kind: 'index' },
  { id: 'fe_created_at_idx', kind: 'index' },
  { id: 'fe_deleted_at_idx', kind: 'index' },
  { id: 'fe_external_path_idx', kind: 'index' },
  { id: 'fe_external_path_lower_unique_idx', kind: 'index' },
  { id: 'group_entity_type_order_key_idx', kind: 'index' },
  { id: 'job_idempotency_key_partial_uq', kind: 'index' },
  { id: 'job_parent_id_idx', kind: 'index' },
  { id: 'job_queue_status_scheduled_at_idx', kind: 'index' },
  { id: 'job_schedule_enabled_next_run_idx', kind: 'index' },
  { id: 'job_schedule_id_finished_at_idx', kind: 'index' },
  { id: 'job_schedule_type_idx', kind: 'index' },
  { id: 'job_schedule_type_name_uq', kind: 'index' },
  { id: 'job_status_idx', kind: 'index' },
  { id: 'knowledge_item_baseId_id_unique', kind: 'index' },
  { id: 'knowledge_item_base_group_created_idx', kind: 'index' },
  { id: 'knowledge_item_base_type_created_idx', kind: 'index' },
  { id: 'malfr_entry_id_idx', kind: 'index' },
  { id: 'malfr_source_id_idx', kind: 'index' },
  { id: 'mcp_server_is_active_idx', kind: 'index' },
  { id: 'mcp_server_name_idx', kind: 'index' },
  { id: 'mcp_server_sort_order_idx', kind: 'index' },
  { id: 'message_fts_identity_unique_index', name: 'message_fts_rowid_uniq', kind: 'index' },
  { id: 'message_parent_id_idx', kind: 'index' },
  { id: 'message_status_idx', kind: 'index' },
  { id: 'message_topic_created_idx', kind: 'index' },
  { id: 'message_topic_root_uniq', kind: 'index' },
  { id: 'mini_app_preset_mini_app_id_idx', kind: 'index' },
  { id: 'mini_app_status_order_key_idx', kind: 'index' },
  { id: 'note_root_path_path_unique_idx', kind: 'index' },
  { id: 'painting_order_key_idx', kind: 'index' },
  { id: 'pfr_entry_id_idx', kind: 'index' },
  { id: 'pfr_source_id_idx', kind: 'index' },
  { id: 'pfr_unique_idx', kind: 'index' },
  { id: 'pin_entity_type_entity_id_unique_idx', kind: 'index' },
  { id: 'pin_entity_type_order_key_idx', kind: 'index' },
  { id: 'plfr_entry_id_idx', kind: 'index' },
  { id: 'plfr_source_id_idx', kind: 'index' },
  { id: 'prompt_order_key_idx', kind: 'index' },
  { id: 'tag_name_unique', kind: 'index' },
  { id: 'topic_assistant_id_idx', kind: 'index' },
  { id: 'topic_order_key_idx', kind: 'index' },
  { id: 'topic_updated_at_idx', kind: 'index' },
  { id: 'translate_history_created_at_idx', kind: 'index' },
  { id: 'translate_history_star_created_at_idx', kind: 'index' },
  { id: 'user_model_preset_idx', kind: 'index' },
  { id: 'user_model_provider_enabled_idx', kind: 'index' },
  { id: 'user_model_provider_id_order_key_idx', kind: 'index' },
  { id: 'user_model_provider_model_unique', kind: 'index' },
  { id: 'user_provider_enabled_idx', kind: 'index' },
  { id: 'user_provider_order_key_idx', kind: 'index' },
  { id: 'user_provider_preset_idx', kind: 'index' },
  { id: '__drizzle_migrations', kind: 'table', columnCount: 3 },
  { id: 'agent', kind: 'table', columnCount: 14 },
  { id: 'agent_channel', kind: 'table', columnCount: 12 },
  { id: 'agent_channel_task', kind: 'table', columnCount: 2 },
  { id: 'agent_global_skill', kind: 'table', columnCount: 13 },
  { id: 'agent_mcp_server', kind: 'table', columnCount: 4 },
  { id: 'agent_session', kind: 'table', columnCount: 10 },
  { id: 'agent_session_message', kind: 'table', columnCount: 13 },
  { id: 'agent_session_message_fts', kind: 'table', columnCount: 3 },
  { id: 'agent_session_message_fts_config', kind: 'table', columnCount: 2 },
  { id: 'agent_session_message_fts_data', kind: 'table', columnCount: 2 },
  { id: 'agent_session_message_fts_docsize', kind: 'table', columnCount: 2 },
  { id: 'agent_session_message_fts_idx', kind: 'table', columnCount: 3 },
  { id: 'agent_skill', kind: 'table', columnCount: 5 },
  { id: 'agent_workspace', kind: 'table', columnCount: 7 },
  { id: 'app_state', kind: 'table', columnCount: 5 },
  { id: 'assistant', kind: 'table', columnCount: 11 },
  { id: 'assistant_knowledge_base', kind: 'table', columnCount: 4 },
  { id: 'assistant_mcp_server', kind: 'table', columnCount: 4 },
  { id: 'chat_message_file_ref', kind: 'table', columnCount: 6 },
  { id: 'entity_tag', kind: 'table', columnCount: 5 },
  { id: 'file_entry', kind: 'table', columnCount: 9 },
  { id: 'group', kind: 'table', columnCount: 6 },
  { id: 'job', kind: 'table', columnCount: 21 },
  { id: 'job_schedule', kind: 'table', columnCount: 12 },
  { id: 'knowledge_base', kind: 'table', columnCount: 17 },
  { id: 'knowledge_item', kind: 'table', columnCount: 9 },
  { id: 'mcp_server', kind: 'table', columnCount: 32 },
  { id: 'message', kind: 'table', columnCount: 15 },
  { id: 'message_fts', kind: 'table', columnCount: 3 },
  { id: 'message_fts_config', kind: 'table', columnCount: 2 },
  { id: 'message_fts_data', kind: 'table', columnCount: 2 },
  { id: 'message_fts_docsize', kind: 'table', columnCount: 2 },
  { id: 'message_fts_idx', kind: 'table', columnCount: 3 },
  { id: 'mini_app', kind: 'table', columnCount: 14 },
  { id: 'mini_app_logo_file_ref', kind: 'table', columnCount: 5 },
  { id: 'note', kind: 'table', columnCount: 7 },
  { id: 'painting', kind: 'table', columnCount: 7 },
  { id: 'painting_file_ref', kind: 'table', columnCount: 6 },
  { id: 'pin', kind: 'table', columnCount: 6 },
  { id: 'preference', kind: 'table', columnCount: 5 },
  { id: 'prompt', kind: 'table', columnCount: 6 },
  { id: 'provider_logo_file_ref', kind: 'table', columnCount: 5 },
  { id: 'tag', kind: 'table', columnCount: 5 },
  { id: 'topic', kind: 'table', columnCount: 10 },
  { id: 'translate_history', kind: 'table', columnCount: 8 },
  { id: 'translate_language', kind: 'table', columnCount: 5 },
  { id: 'user_model', kind: 'table', columnCount: 27 },
  { id: 'user_provider', kind: 'table', columnCount: 14 },
  { id: 'agent_session_message_ad', kind: 'trigger' },
  { id: 'agent_session_message_ai', kind: 'trigger' },
  { id: 'agent_session_message_au', kind: 'trigger' },
  { id: 'message_ad', kind: 'trigger' },
  { id: 'message_ai', kind: 'trigger' },
  { id: 'message_au', kind: 'trigger' }
] as const

type ExpectedObjectId = (typeof EXPECTED_MIGRATION_DATABASE_OBJECTS)[number]['id']
const expectedObjectIds = EXPECTED_MIGRATION_DATABASE_OBJECTS.map((object) => object.id) as [
  ExpectedObjectId,
  ...ExpectedObjectId[]
]

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
export const migrationDatabaseIntegerBucketSchema = z.enum(['0', '1_to_10', '11_to_100', '101_to_1000', '1001_plus'])
export const migrationDatabaseFailureCodeSchema = z.enum([
  'invalid_input',
  'permission_denied',
  'not_regular_file',
  'not_database',
  'read_failed',
  'open_failed',
  'query_failed',
  'worker_error',
  'worker_exit',
  'worker_no_result',
  'worker_timeout',
  'protocol_error'
])

export const migrationDatabaseExpectedObjectDefinitionSchema = z
  .object({
    id: migrationDatabaseExpectedObjectIdSchema,
    name: z
      .string()
      .regex(/^[A-Za-z0-9_]+$/)
      .max(128)
      .optional(),
    kind: migrationDatabaseObjectKindSchema,
    columnCount: z.number().int().min(0).max(512).optional()
  })
  .strict()

export const migrationDatabaseWorkerPolicySchema = z
  .object({
    version: z.literal(MIGRATION_DATABASE_DIAGNOSTIC_VERSION),
    expectedSchemaVersion: z.literal(MIGRATION_DATABASE_EXPECTED_SCHEMA_VERSION),
    maxMessageBytes: z.literal(MIGRATION_DATABASE_DIAGNOSTIC_MAX_MESSAGE_BYTES),
    maxSchemaObjects: z.literal(MIGRATION_DATABASE_DIAGNOSTIC_MAX_SCHEMA_OBJECTS),
    maxForeignKeyRows: z.literal(MIGRATION_DATABASE_DIAGNOSTIC_MAX_FOREIGN_KEY_ROWS),
    maxForeignKeyGroups: z.literal(MIGRATION_DATABASE_DIAGNOSTIC_MAX_FOREIGN_KEY_GROUPS),
    expectedObjects: z
      .array(migrationDatabaseExpectedObjectDefinitionSchema)
      .length(EXPECTED_MIGRATION_DATABASE_OBJECTS.length)
  })
  .strict()

export const migrationDatabaseDiagnosticsWorkerInputSchema = z
  .object({
    databaseFile: z.string().min(1).max(32_768),
    policy: migrationDatabaseWorkerPolicySchema
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
    header: z.enum(['unavailable', 'insufficient', 'valid', 'invalid'])
  })
  .strict()

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
    objects: z
      .array(migrationDatabaseL1ObjectSchema)
      .max(MIGRATION_DATABASE_DIAGNOSTIC_MAX_SCHEMA_OBJECTS)
      .superRefine((objects, ctx) => {
        const ids = new Set<string>()
        for (const [index, object] of objects.entries()) {
          if (ids.has(object.id)) {
            ctx.addIssue({
              code: 'custom',
              message: 'Expected database object IDs must be unique',
              path: [index, 'id']
            })
          }
          ids.add(object.id)
        }
      }),
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
      .strict(),
    z
      .object({
        level: z.literal(level),
        status: z.literal('timed_out'),
        code: z.literal('worker_timeout')
      })
      .strict()
  ])
}

export const migrationDatabaseL0StepSchema = createStepSchema('l0', migrationDatabaseL0DataSchema)
export const migrationDatabaseL1StepSchema = createStepSchema('l1', migrationDatabaseL1DataSchema)
export const migrationDatabaseL2StepSchema = createStepSchema('l2', migrationDatabaseL2DataSchema)
export const migrationDatabaseDiagnosticStepSchema = z.union([
  migrationDatabaseL0StepSchema,
  migrationDatabaseL1StepSchema,
  migrationDatabaseL2StepSchema
])

export const migrationDatabaseDiagnosticResultSchema = z
  .object({
    version: z.literal(MIGRATION_DATABASE_DIAGNOSTIC_VERSION),
    expectedSchemaVersion: z.literal(MIGRATION_DATABASE_EXPECTED_SCHEMA_VERSION),
    l0: migrationDatabaseL0StepSchema,
    l1: migrationDatabaseL1StepSchema,
    l2: migrationDatabaseL2StepSchema
  })
  .strict()

export const migrationDatabaseDiagnosticsWorkerMessageSchema = z.union([
  z.object({ type: z.literal('step'), step: migrationDatabaseDiagnosticStepSchema }).strict(),
  z.object({ type: z.literal('result'), result: migrationDatabaseDiagnosticResultSchema }).strict()
])

export type MigrationDatabaseExpectedObjectId = z.infer<typeof migrationDatabaseExpectedObjectIdSchema>
export type MigrationDatabaseObjectKind = z.infer<typeof migrationDatabaseObjectKindSchema>
export type MigrationDatabaseUnknownObjectKind = z.infer<typeof migrationDatabaseUnknownObjectKindSchema>
export type MigrationDatabaseCountBucket = z.infer<typeof migrationDatabaseCountBucketSchema>
export type MigrationDatabaseColumnCountBucket = z.infer<typeof migrationDatabaseColumnCountBucketSchema>
export type MigrationDatabaseFailureCode = z.infer<typeof migrationDatabaseFailureCodeSchema>
export type MigrationDatabaseExpectedObjectDefinition = z.infer<typeof migrationDatabaseExpectedObjectDefinitionSchema>
export type MigrationDatabaseWorkerPolicy = z.infer<typeof migrationDatabaseWorkerPolicySchema>
export type MigrationDatabaseDiagnosticsWorkerInput = z.infer<typeof migrationDatabaseDiagnosticsWorkerInputSchema>
export type MigrationDatabaseL0Data = z.infer<typeof migrationDatabaseL0DataSchema>
export type MigrationDatabaseL1Data = z.infer<typeof migrationDatabaseL1DataSchema>
export type MigrationDatabaseL2Data = z.infer<typeof migrationDatabaseL2DataSchema>
export type MigrationDatabaseL0Step = z.infer<typeof migrationDatabaseL0StepSchema>
export type MigrationDatabaseL1Step = z.infer<typeof migrationDatabaseL1StepSchema>
export type MigrationDatabaseL2Step = z.infer<typeof migrationDatabaseL2StepSchema>
export type MigrationDatabaseDiagnosticStep = z.infer<typeof migrationDatabaseDiagnosticStepSchema>
export type MigrationDatabaseDiagnosticResult = z.infer<typeof migrationDatabaseDiagnosticResultSchema>
export type MigrationDatabaseDiagnosticsWorkerMessage = z.infer<typeof migrationDatabaseDiagnosticsWorkerMessageSchema>
