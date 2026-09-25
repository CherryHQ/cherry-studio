import * as z from 'zod'

const NonBlankStringSchema = z.string().trim().min(1)
const NullableNonBlankStringSchema = NonBlankStringSchema.nullable()
const NullableTimestampSchema = z.iso.datetime().nullable()
const NullableCountSchema = z.number().int().nonnegative().nullable()

export const EXTERNAL_KNOWLEDGE_SOURCE_STATES = ['active', 'paused'] as const
export const ExternalKnowledgeSourceStateSchema = z.enum(EXTERNAL_KNOWLEDGE_SOURCE_STATES)
export type ExternalKnowledgeSourceState = z.infer<typeof ExternalKnowledgeSourceStateSchema>

export const EXTERNAL_KNOWLEDGE_SYNC_TRIGGERS = ['initial', 'manual', 'scheduled', 'startup'] as const
export const ExternalKnowledgeSyncTriggerSchema = z.enum(EXTERNAL_KNOWLEDGE_SYNC_TRIGGERS)
export type ExternalKnowledgeSyncTrigger = z.infer<typeof ExternalKnowledgeSyncTriggerSchema>

export const EXTERNAL_KNOWLEDGE_SYNC_OUTCOMES = ['completed', 'completed-with-warnings', 'failed', 'cancelled'] as const
export const ExternalKnowledgeSyncOutcomeSchema = z.enum(EXTERNAL_KNOWLEDGE_SYNC_OUTCOMES)
export type ExternalKnowledgeSyncOutcome = z.infer<typeof ExternalKnowledgeSyncOutcomeSchema>

export const FeishuExternalKnowledgeScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('space') }),
  z.strictObject({ kind: z.literal('node'), nodeId: NonBlankStringSchema }),
  z.strictObject({
    kind: z.literal('document'),
    nodeId: NonBlankStringSchema,
    remoteObjectId: NonBlankStringSchema
  })
])
export type FeishuExternalKnowledgeScope = z.infer<typeof FeishuExternalKnowledgeScopeSchema>

const ExternalKnowledgeSourceBaseSchema = z.strictObject({
  id: z.uuidv7(),
  baseId: z.uuidv4(),
  connectionId: z.uuidv7(),
  name: NonBlankStringSchema,
  state: ExternalKnowledgeSourceStateSchema,
  scheduleId: NonBlankStringSchema.nullable(),
  revision: z.number().int().nonnegative(),
  activeJobId: z.uuidv7().nullable(),
  lastTrigger: ExternalKnowledgeSyncTriggerSchema.nullable(),
  lastStartedAt: NullableTimestampSchema,
  lastFinishedAt: NullableTimestampSchema,
  lastOutcome: ExternalKnowledgeSyncOutcomeSchema.nullable(),
  lastScannedCount: NullableCountSchema,
  lastIndexedCount: NullableCountSchema,
  lastUnchangedCount: NullableCountSchema,
  lastSkippedCount: NullableCountSchema,
  lastWarningCount: NullableCountSchema,
  lastErrorSummary: NullableNonBlankStringSchema,
  lastSuccessfulSyncAt: NullableTimestampSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

const FeishuExternalKnowledgeSourceSchema = ExternalKnowledgeSourceBaseSchema.extend({
  provider: z.literal('feishu'),
  tenantId: NonBlankStringSchema,
  spaceId: NonBlankStringSchema,
  scope: FeishuExternalKnowledgeScopeSchema
})

export const ExternalKnowledgeSourceSchema = z.discriminatedUnion('provider', [FeishuExternalKnowledgeSourceSchema])
export type ExternalKnowledgeSource = z.infer<typeof ExternalKnowledgeSourceSchema>

export const EXTERNAL_KNOWLEDGE_DOCUMENT_AVAILABILITIES = ['active', 'unavailable'] as const
export const ExternalKnowledgeDocumentAvailabilitySchema = z.enum(EXTERNAL_KNOWLEDGE_DOCUMENT_AVAILABILITIES)
export type ExternalKnowledgeDocumentAvailability = z.infer<typeof ExternalKnowledgeDocumentAvailabilitySchema>

const ExternalKnowledgeDocumentBaseSchema = z.strictObject({
  id: z.uuidv7(),
  sourceId: z.uuidv7(),
  remoteObjectId: NonBlankStringSchema,
  canonicalNodeId: NonBlankStringSchema,
  parentNodeId: NullableNonBlankStringSchema,
  relativeBreadcrumb: z.array(NonBlankStringSchema),
  title: NonBlankStringSchema,
  originalUrl: z.url(),
  remoteRevision: NullableNonBlankStringSchema,
  contentHash: NullableNonBlankStringSchema,
  lastSeenAt: z.iso.datetime(),
  currentWarning: NullableNonBlankStringSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

export const ExternalKnowledgeDocumentSchema = z.discriminatedUnion('availability', [
  ExternalKnowledgeDocumentBaseSchema.extend({
    availability: z.literal('active'),
    knowledgeItemId: z.uuidv7()
  }),
  ExternalKnowledgeDocumentBaseSchema.extend({
    availability: z.literal('unavailable'),
    knowledgeItemId: z.null()
  })
])
export type ExternalKnowledgeDocument = z.infer<typeof ExternalKnowledgeDocumentSchema>
