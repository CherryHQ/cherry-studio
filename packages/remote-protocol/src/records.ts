import * as z from 'zod'

import { remoteFailureSchema } from './errors'
import { decimal, opaqueId } from './values'

export const uploadTransferLimits = Object.freeze({
  chunkBytes: 1024 * 1024,
  headerBytes: 4096,
  window: 2,
  queuedBytes: 4 * 1024 * 1024
})
export const uploadChunkHeaderSchema = z.strictObject({
  kind: z.literal('upload'),
  requestId: opaqueId,
  uploadId: opaqueId,
  writerEpoch: decimal,
  offset: decimal
})
export type UploadChunkHeader = z.infer<typeof uploadChunkHeaderSchema>
export type UploadChunk = UploadChunkHeader & { bytes: Uint8Array }
export const uploadAckSchema = z.strictObject({
  jsonrpc: z.literal('2.0'),
  method: z.literal('agent.uploads.ack'),
  params: z.discriminatedUnion('ok', [
    z.strictObject({
      ok: z.literal(true),
      requestId: opaqueId,
      uploadId: opaqueId,
      writerEpoch: decimal,
      committedOffset: decimal
    }),
    z.strictObject({ ok: z.literal(false), requestId: opaqueId, error: remoteFailureSchema })
  ])
})
export type UploadAck = z.infer<typeof uploadAckSchema>['params']
export function isUploadChunk(value: unknown): value is UploadChunk {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'upload' &&
    'bytes' in value &&
    value.bytes instanceof Uint8Array
  )
}
