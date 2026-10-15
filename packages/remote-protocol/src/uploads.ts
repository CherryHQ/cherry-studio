import * as z from 'zod'

import { remoteFailureSchema } from './errors'
import { decimal, opaqueId, timestamp, unicodeText } from './values'

export const uploadLimits = Object.freeze({
  fileBytes: 1024 ** 3,
  messageBytes: 2 * 1024 ** 3,
  files: 8,
  retentionMs: 24 * 60 * 60 * 1000,
  lifetimeMs: 7 * 24 * 60 * 60 * 1000,
  deviceBytes: 4 * 1024 ** 3,
  stagingBytes: 8 * 1024 ** 3
})
/** Capability whose grant owns an upload; consumers accept only uploads owned by their own grant. */
export const uploadDomainSchema = z.enum(['agent', 'assistant'])
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
  checksumAlgorithm: z.literal('sha256').optional(),
  byteLength: z.number().int().min(0).max(uploadLimits.fileBytes)
})
export const uploadReferenceSchema = z.strictObject({ uploadId: opaqueId })
export const uploadWriterSchema = uploadReferenceSchema.extend({ writerEpoch: decimal })
export const uploadCompleteSchema = uploadWriterSchema.extend({
  expectedSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional()
})
export const uploadStateSchema = z.looseObject({
  uploadId: opaqueId,
  state: z.enum(['receiving', 'verifying', 'ready', 'failed']),
  committedOffset: decimal,
  writerEpoch: decimal,
  checksumAlgorithm: z.literal('sha256').optional(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  failureCode: z.enum(['CHECKSUM_MISMATCH', 'VERIFICATION_FAILED']).optional(),
  expiresAt: timestamp
})
export const uploadResumeSchema = uploadReferenceSchema.extend({ resumeId: opaqueId, expectedWriterEpoch: decimal })
export const uploadReferencesSchema = z
  .array(uploadReferenceSchema)
  .min(1)
  .max(uploadLimits.files)
  .refine((files) => new Set(files.map((file) => file.uploadId)).size === files.length)

const method = <P extends z.ZodType, R extends z.ZodType>(params: P, result: R) => ({
  params,
  result,
  errors: remoteFailureSchema
})
const domain = { domain: uploadDomainSchema }
export const uploadMethods = {
  'uploads.prepare': method(uploadMetadataSchema.extend(domain), uploadStateSchema),
  'uploads.get': method(uploadReferenceSchema.extend(domain), uploadStateSchema),
  'uploads.resume': method(uploadResumeSchema.extend(domain), uploadStateSchema),
  'uploads.complete': method(uploadCompleteSchema.extend(domain), uploadStateSchema),
  'uploads.cancel': method(uploadReferenceSchema.extend(domain), z.looseObject({ cancelled: z.literal(true) }))
}

export type UploadDomain = z.infer<typeof uploadDomainSchema>
export type UploadMethod = keyof typeof uploadMethods
export type UploadParams<M extends UploadMethod> = z.infer<(typeof uploadMethods)[M]['params']>
export type UploadComplete = z.infer<typeof uploadCompleteSchema>
export type UploadMetadata = z.infer<typeof uploadMetadataSchema>
export type UploadReference = z.infer<typeof uploadReferenceSchema>
export type UploadState = z.infer<typeof uploadStateSchema>
export type UploadResume = z.infer<typeof uploadResumeSchema>
