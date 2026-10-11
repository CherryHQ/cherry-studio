import * as z from 'zod'

import { decimal, opaqueId, timestamp, unicodeText } from '../values'

export const agentUploadLimits = Object.freeze({
  fileBytes: 1024 ** 3,
  messageBytes: 2 * 1024 ** 3,
  files: 8,
  retentionMs: 24 * 60 * 60 * 1000,
  lifetimeMs: 7 * 24 * 60 * 60 * 1000,
  deviceBytes: 4 * 1024 ** 3,
  stagingBytes: 8 * 1024 ** 3
})
export const uploadMetadataSchema = z.strictObject({
  uploadId: opaqueId,
  filename: unicodeText
    .trim()
    .min(1)
    .max(255)
    .refine(
      (name) =>
        !/[\\/:*?"<>|]/.test(name) &&
        !Array.from(name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) &&
        name !== '.' &&
        name !== '..' &&
        new TextEncoder().encode(name).length <= 255
    ),
  mediaType: z
    .string()
    .regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/)
    .max(128),
  byteLength: z.number().int().min(0).max(agentUploadLimits.fileBytes)
})
export const uploadReferenceSchema = z.strictObject({ uploadId: opaqueId })
export const uploadWriterSchema = uploadReferenceSchema.extend({ writerEpoch: decimal })
export const uploadStateSchema = z.looseObject({
  uploadId: opaqueId,
  state: z.enum(['receiving', 'verifying', 'ready', 'failed']),
  committedOffset: decimal,
  writerEpoch: decimal,
  expiresAt: timestamp
})
export const uploadResumeSchema = uploadReferenceSchema.extend({ resumeId: opaqueId, expectedWriterEpoch: decimal })
export const uploadReferencesSchema = z
  .array(uploadReferenceSchema)
  .min(1)
  .max(agentUploadLimits.files)
  .refine((files) => new Set(files.map((file) => file.uploadId)).size === files.length)
export type AgentUploadMetadata = z.infer<typeof uploadMetadataSchema>
export type AgentUploadReference = z.infer<typeof uploadReferenceSchema>
export type AgentUploadState = z.infer<typeof uploadStateSchema>
export type AgentUploadResume = z.infer<typeof uploadResumeSchema>
