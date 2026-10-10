import * as z from 'zod'

import { decimal, opaqueId } from '../values'
import { agentUploadLimits, uploadMetadataSchema, type uploadStateSchema } from './uploads'

export const attachmentDraftItemSchema = uploadMetadataSchema.extend({ attachmentId: opaqueId })
export const attachmentDraftManifestSchema = z
  .array(attachmentDraftItemSchema)
  .max(agentUploadLimits.files)
  .refine(
    (items) =>
      new Set(items.map((item) => item.attachmentId)).size === items.length &&
      new Set(items.map((item) => item.uploadId)).size === items.length &&
      items.reduce((sum, item) => sum + item.byteLength, 0) <= agentUploadLimits.messageBytes
  )
export const attachmentDraftSubmissionSchema = z.strictObject({ draftId: opaqueId, manifestRevision: decimal })
export type AgentAttachmentDraftItem = z.infer<typeof attachmentDraftItemSchema>

export const attachmentSelectionSchema = z.strictObject({
  selectionId: opaqueId,
  sessionId: opaqueId,
  sequence: decimal,
  items: attachmentDraftManifestSchema
})
export type AgentAttachmentSelection = Omit<z.infer<typeof attachmentSelectionSchema>, 'items'> & {
  messageId?: string
  items: Array<AgentAttachmentDraftItem & { upload?: z.infer<typeof uploadStateSchema> }>
}
