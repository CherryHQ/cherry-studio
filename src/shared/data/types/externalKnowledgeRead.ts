import * as z from 'zod'

import { FeishuExternalKnowledgeScopeSchema } from './externalKnowledge'

const NonBlankStringSchema = z.string().trim().min(1)

export const EXTERNAL_KNOWLEDGE_DOCUMENT_KINDS = [
  'document',
  'spreadsheet',
  'database',
  'presentation',
  'file',
  'other'
] as const
export const ExternalKnowledgeDocumentKindSchema = z.enum(EXTERNAL_KNOWLEDGE_DOCUMENT_KINDS)
export type ExternalKnowledgeDocumentKind = z.infer<typeof ExternalKnowledgeDocumentKindSchema>

export const EXTERNAL_KNOWLEDGE_SUPPORT_STATES = ['supported', 'unsupported', 'skipped'] as const
export const ExternalKnowledgeSupportStateSchema = z.enum(EXTERNAL_KNOWLEDGE_SUPPORT_STATES)
export type ExternalKnowledgeSupportState = z.infer<typeof ExternalKnowledgeSupportStateSchema>

export const ExternalKnowledgeReadDescriptorSchema = z.strictObject({
  remoteObjectId: NonBlankStringSchema,
  nodeId: NonBlankStringSchema,
  parentNodeId: NonBlankStringSchema.nullable(),
  relativeBreadcrumb: z.array(NonBlankStringSchema).min(1),
  title: NonBlankStringSchema,
  originalUrl: z.url(),
  remoteRevision: NonBlankStringSchema.nullable(),
  documentKind: ExternalKnowledgeDocumentKindSchema,
  supportState: ExternalKnowledgeSupportStateSchema
})
export type ExternalKnowledgeReadDescriptor = z.infer<typeof ExternalKnowledgeReadDescriptorSchema>

export const ExternalKnowledgeDocumentReadSchema = z.strictObject({
  descriptor: ExternalKnowledgeReadDescriptorSchema,
  contentType: z.literal('markdown'),
  content: z.string()
})
export type ExternalKnowledgeDocumentRead = z.infer<typeof ExternalKnowledgeDocumentReadSchema>

const ExternalKnowledgeResolvedAccountSchema = z.strictObject({
  userId: NonBlankStringSchema,
  displayName: NonBlankStringSchema.nullable()
})

const FeishuExternalKnowledgeScopeResolutionSchema = z.strictObject({
  provider: z.literal('feishu'),
  connectionId: z.uuidv7(),
  account: ExternalKnowledgeResolvedAccountSchema,
  tenantId: NonBlankStringSchema,
  spaceId: NonBlankStringSchema,
  scope: FeishuExternalKnowledgeScopeSchema,
  selected: ExternalKnowledgeReadDescriptorSchema
})

export const ExternalKnowledgeScopeResolutionSchema = z.discriminatedUnion('provider', [
  FeishuExternalKnowledgeScopeResolutionSchema
])
export type ExternalKnowledgeScopeResolution = z.infer<typeof ExternalKnowledgeScopeResolutionSchema>

export const EXTERNAL_KNOWLEDGE_PREVIEW_WARNINGS = ['no-supported-documents'] as const
export const ExternalKnowledgePreviewWarningSchema = z.enum(EXTERNAL_KNOWLEDGE_PREVIEW_WARNINGS)
export type ExternalKnowledgePreviewWarning = z.infer<typeof ExternalKnowledgePreviewWarningSchema>

export const ExternalKnowledgeScopePreviewSchema = z.strictObject({
  resolution: ExternalKnowledgeScopeResolutionSchema,
  visibleNodeCount: z.number().int().nonnegative(),
  supportedDocxCount: z.number().int().nonnegative(),
  unsupportedOrSkippedCount: z.number().int().nonnegative(),
  embeddingCostExact: z.literal(false),
  warnings: z.array(ExternalKnowledgePreviewWarningSchema)
})
export type ExternalKnowledgeScopePreview = z.infer<typeof ExternalKnowledgeScopePreviewSchema>
