export const fileIntakeLimits = Object.freeze({
  fileBytes: 1024 ** 3,
  chunkBytes: 1024 * 1024,
  retentionMs: 24 * 60 * 60 * 1000,
  lifetimeMs: 7 * 24 * 60 * 60 * 1000,
  ownerBytes: 4 * 1024 ** 3,
  stagingBytes: 8 * 1024 ** 3
})

export type FileIntakeMetadata = {
  uploadId: string
  filename: string
  mediaType: string
  byteLength: number
}
export type FileIntakeSnapshot = {
  uploadId: string
  state: 'receiving' | 'verifying' | 'ready' | 'failed'
  committedOffset: string
  writerEpoch: string
  expiresAt: string
}
export type FileIntakeWrite = {
  uploadId: string
  writerEpoch: string
  offset: string
  bytes: Uint8Array
}
export type FileIntakeResume = { uploadId: string; resumeId: string; expectedWriterEpoch: string }
