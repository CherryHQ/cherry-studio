import * as z from 'zod'

import { attachmentDraftManifestSchema, type AgentAttachmentSelection } from './agent/attachmentDrafts'
import {
  commandReceiptSchema,
  executionSchema,
  interactionSchema,
  messageSchema,
  modelSummarySchema,
  partSchema
} from './agent/resources'
import { encodeCanonical } from './encoding'
import { remoteFailureSchema } from './errors'
import { uploadReferencesSchema } from './uploads'
import { decimal, digest, opaqueId, pageOf, pageParams, timestamp, unicodeText } from './values'

export const assistantCatalogSchema = z.looseObject({
  assistantId: opaqueId,
  name: unicodeText.max(4096),
  emoji: unicodeText.max(64).optional(),
  model: modelSummarySchema.nullable(),
  configurationRevision: digest,
  available: z.boolean()
})
export const assistantTopicSchema = z.looseObject({
  topicId: opaqueId,
  assistantId: opaqueId.nullable(),
  title: unicodeText.max(255),
  updatedAt: timestamp,
  parentAnchorId: opaqueId.nullable(),
  historyRevision: decimal,
  activeExecutionIds: z.array(opaqueId).max(100)
})
export const assistantMessageSchema = messageSchema.safeExtend({
  parentId: opaqueId.nullable(),
  replyGroupId: decimal.optional(),
  partCount: z.number().int().nonnegative().optional(),
  author: z
    .looseObject({ assistantId: opaqueId, name: unicodeText.max(4096), emoji: unicodeText.max(64).optional() })
    .optional()
})
export const assistantInteractionSchema = interactionSchema.extend({
  messageId: opaqueId,
  configurationRevision: digest,
  respondable: z.boolean(),
  desktopRequired: z.boolean()
})
export const assistantAttachmentSelectionSchema = z.strictObject({
  selectionId: opaqueId,
  topicId: opaqueId,
  sequence: decimal,
  items: attachmentDraftManifestSchema
})
export const assistantCursorSchema = z.strictObject({ topicId: opaqueId, streamEpoch: opaqueId, seq: decimal })
const event = { seq: decimal }
export const assistantEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...event, kind: z.literal('topic.updated'), topic: assistantTopicSchema }),
  z.strictObject({ ...event, kind: z.literal('message.updated'), message: assistantMessageSchema }),
  z.strictObject({ ...event, kind: z.literal('message.removed'), messageId: opaqueId }),
  z.strictObject({
    ...event,
    kind: z.literal('part.updated'),
    messageId: opaqueId,
    afterPartId: opaqueId.nullable(),
    part: partSchema
  }),
  z.strictObject({ ...event, kind: z.literal('part.removed'), messageId: opaqueId, partId: opaqueId }),
  z.strictObject({
    ...event,
    kind: z.literal('part.append'),
    messageId: opaqueId,
    partId: opaqueId,
    baseRevision: decimal,
    revision: decimal,
    offsetUtf8: decimal,
    text: unicodeText.max(2048)
  }),
  z.strictObject({ ...event, kind: z.literal('execution.updated'), execution: executionSchema }),
  z.strictObject({ ...event, kind: z.literal('interaction.updated'), interaction: assistantInteractionSchema })
])
export const assistantBatchSchema = z.strictObject({
  subscriptionId: opaqueId,
  topicId: opaqueId,
  streamEpoch: opaqueId,
  events: z.array(assistantEventSchema).min(1).max(256)
})
export const assistantNotificationSchema = z.discriminatedUnion('method', [
  z.strictObject({ jsonrpc: z.literal('2.0'), method: z.literal('assistant.events'), params: assistantBatchSchema }),
  z.strictObject({
    jsonrpc: z.literal('2.0'),
    method: z.literal('assistant.subscriptions.resetRequired'),
    params: z.strictObject({
      subscriptionId: opaqueId,
      reason: z.enum(['RESET_REQUIRED', 'CHECKPOINT_EXPIRED', 'RESOURCE_EXHAUSTED'])
    })
  })
])
export const assistantProjectionSchema = z.strictObject({
  cursor: assistantCursorSchema,
  topic: assistantTopicSchema,
  messages: z.record(z.string(), assistantMessageSchema),
  parts: z.record(z.string(), partSchema),
  executions: z.record(z.string(), executionSchema),
  interactions: z.record(z.string(), assistantInteractionSchema)
})
export const assistantCheckpointItemSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('topic'), value: assistantTopicSchema }),
  z.strictObject({ kind: z.literal('message'), value: assistantMessageSchema }),
  z.strictObject({ kind: z.literal('part'), messageId: opaqueId, value: partSchema }),
  z.strictObject({ kind: z.literal('execution'), value: executionSchema }),
  z.strictObject({ kind: z.literal('interaction'), value: assistantInteractionSchema })
])
export const assistantCheckpointDescriptorSchema = z.looseObject({
  checkpointId: opaqueId,
  cursor: assistantCursorSchema,
  historyRevision: decimal,
  pageCount: z.number().int().positive(),
  byteLength: decimal,
  sha256: digest,
  expiresAt: timestamp
})
export const assistantCheckpointPageSchema = z.looseObject({
  checkpointId: opaqueId,
  pageIndex: z.number().int().nonnegative(),
  items: z.array(assistantCheckpointItemSchema).max(100),
  nextCursor: opaqueId.nullable(),
  pageDigest: digest
})
const method = <P extends z.ZodType, R extends z.ZodType>(params: P, result: R) => ({
  params,
  result,
  errors: remoteFailureSchema
})
const topic = { topicId: opaqueId }
const view = { ...topic, parentAnchorId: opaqueId.nullable(), historyRevision: decimal }
const command = { commandId: opaqueId, ...topic }
const subscription = { subscriptionId: opaqueId }
export const assistantMethods = {
  'assistant.assistants.list': method(z.strictObject(pageParams), pageOf(assistantCatalogSchema)),
  'assistant.topics.list': method(
    z.strictObject({ assistantId: opaqueId.optional(), ...pageParams }),
    pageOf(assistantTopicSchema)
  ),
  'assistant.topics.get': method(z.strictObject(topic), z.looseObject({ topic: assistantTopicSchema })),
  'assistant.topics.create': method(
    z.strictObject({ commandId: opaqueId, assistantId: opaqueId, title: unicodeText.max(255).optional() }),
    commandReceiptSchema
  ),
  'assistant.messages.list': method(z.strictObject({ ...view, ...pageParams }), pageOf(assistantMessageSchema)),
  'assistant.parts.list': method(
    z.strictObject({ ...view, messageId: opaqueId, messageRevision: decimal, ...pageParams }),
    pageOf(partSchema)
  ),
  'assistant.content.read': method(
    z.strictObject({
      ...view,
      contentId: opaqueId,
      revision: decimal,
      offset: decimal,
      maxBytes: z.number().int().min(1).max(24_576)
    }),
    z.looseObject({
      contentId: opaqueId,
      revision: decimal,
      offset: decimal,
      dataBase64: z.string().max(32_768),
      nextOffset: decimal,
      eof: z.boolean(),
      sha256: digest
    })
  ),
  'assistant.attachments.present': method(
    assistantAttachmentSelectionSchema,
    z.strictObject({ accepted: z.boolean() })
  ),
  'assistant.messages.send': method(
    z
      .strictObject({
        ...command,
        assistantId: opaqueId,
        expectedAssistantRevision: digest,
        parentAnchorId: opaqueId.nullable(),
        expectedHistoryRevision: decimal,
        text: unicodeText.max(32_768),
        attachments: uploadReferencesSchema.optional(),
        selectionId: opaqueId.optional()
      })
      .refine((input) => Boolean(input.text.trim()) || Boolean(input.attachments?.length)),
    commandReceiptSchema
  ),
  'assistant.executions.cancel': method(
    z.strictObject({ ...command, expectedExecutionIds: z.array(opaqueId).min(1).max(100) }),
    commandReceiptSchema
  ),
  'assistant.interactions.list': method(
    z.strictObject({ ...topic, ...pageParams }),
    pageOf(assistantInteractionSchema)
  ),
  'assistant.interactions.get': method(
    z.strictObject({ ...topic, interactionId: opaqueId }),
    z.looseObject({ interaction: assistantInteractionSchema })
  ),
  'assistant.interactions.respond': method(
    z.strictObject({
      ...command,
      messageId: opaqueId,
      interactionId: opaqueId,
      expectedRevision: decimal,
      expectedExecutionId: opaqueId,
      expectedAssistantRevision: digest,
      inputDigest: digest,
      decision: z.enum(['approve', 'deny'])
    }),
    commandReceiptSchema
  ),
  'assistant.commands.get': method(z.strictObject({ commandId: opaqueId }), commandReceiptSchema),
  'assistant.topics.subscribe': method(
    z.strictObject({ ...topic, cursor: assistantCursorSchema.optional() }),
    z.union([
      z.looseObject({
        ...subscription,
        mode: z.literal('replay'),
        fromCursor: assistantCursorSchema,
        highWatermark: assistantCursorSchema,
        leaseExpiresAt: timestamp
      }),
      z.looseObject({ ...subscription, mode: z.literal('checkpoint'), checkpoint: assistantCheckpointDescriptorSchema })
    ])
  ),
  'assistant.checkpoints.read': method(
    z.strictObject({ ...subscription, checkpointId: opaqueId, pageCursor: opaqueId.optional() }),
    assistantCheckpointPageSchema
  ),
  'assistant.subscriptions.activate': method(
    z.strictObject({ ...subscription, appliedCursor: assistantCursorSchema }),
    z.looseObject({ ...subscription, status: z.literal('active') })
  ),
  'assistant.subscriptions.ack': method(
    z.strictObject({ ...subscription, cursor: assistantCursorSchema }),
    z.looseObject({ acknowledged: assistantCursorSchema })
  ),
  'assistant.subscriptions.close': method(z.strictObject(subscription), z.looseObject({ closed: z.literal(true) }))
}
export type AssistantMethod = keyof typeof assistantMethods
export type AssistantParams<M extends AssistantMethod> = z.infer<(typeof assistantMethods)[M]['params']>
export type AssistantResult<M extends AssistantMethod> = z.infer<(typeof assistantMethods)[M]['result']>
export type AssistantMutation =
  | 'assistant.topics.create'
  | 'assistant.messages.send'
  | 'assistant.executions.cancel'
  | 'assistant.interactions.respond'
export type AssistantTopic = z.infer<typeof assistantTopicSchema>
export type AssistantMessage = z.infer<typeof assistantMessageSchema>
export type AssistantInteraction = z.infer<typeof assistantInteractionSchema>
export type AssistantAttachmentSelection = Omit<z.infer<typeof assistantAttachmentSelectionSchema>, 'items'> &
  Pick<AgentAttachmentSelection, 'messageId' | 'items'>
export type AssistantCursor = z.infer<typeof assistantCursorSchema>
export type AssistantEvent = z.infer<typeof assistantEventSchema>
export type AssistantBatch = z.infer<typeof assistantBatchSchema>
export type AssistantNotification = z.infer<typeof assistantNotificationSchema>
export type AssistantCheckpointDescriptor = z.infer<typeof assistantCheckpointDescriptorSchema>
export type AssistantCheckpointPage = z.infer<typeof assistantCheckpointPageSchema>
export type AssistantCheckpointItem = z.infer<typeof assistantCheckpointItemSchema>

export function encodeAssistantCommand<M extends AssistantMutation>(name: M, params: AssistantParams<M>): Uint8Array {
  assistantMethods[name].params.parse(params)
  return encodeCanonical({
    method: name,
    params: Object.fromEntries(Object.entries(params).filter(([key]) => key !== 'commandId'))
  })
}
export function encodeAssistantCheckpointPage(page: AssistantCheckpointPage): Uint8Array {
  const { checkpointId, pageIndex, items, nextCursor } = assistantCheckpointPageSchema.parse(page)
  return encodeCanonical({ checkpointId, pageIndex, items, nextCursor })
}

export { applyAssistantEvents, installAssistantCheckpoint } from './assistantRecovery'
export type { AssistantProjection } from './assistantRecovery'
