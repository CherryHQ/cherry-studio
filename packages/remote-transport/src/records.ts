import {
  isUploadChunk,
  remoteLimits,
  uploadChunkHeaderSchema,
  uploadTransferLimits
} from '@cherrystudio/remote-protocol'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
export const binaryRecordBytes = uploadTransferLimits.chunkBytes + uploadTransferLimits.headerBytes + 3

export function encodeRecord(value: unknown): Uint8Array {
  if (isUploadChunk(value)) {
    const { bytes, ...input } = value
    const header = encoder.encode(JSON.stringify(uploadChunkHeaderSchema.parse(input)))
    if (
      !bytes.length ||
      bytes.length > uploadTransferLimits.chunkBytes ||
      header.length > uploadTransferLimits.headerBytes
    )
      throw new Error('Upload record exceeds limit')
    const record = new Uint8Array(3 + header.length + bytes.length)
    record[0] = 1
    new DataView(record.buffer).setUint16(1, header.length)
    record.set(header, 3)
    record.set(bytes, 3 + header.length)
    return record
  }
  const bytes = encoder.encode(JSON.stringify(value))
  if (bytes.length > remoteLimits.recordBytes) throw new Error('Remote record budget exceeded')
  return bytes
}

export function decodeRecord(bytes: Uint8Array): unknown {
  if (bytes[0] !== 1) {
    const json = bytes
    if (json.length > remoteLimits.recordBytes) throw new Error('Remote record budget exceeded')
    return JSON.parse(decoder.decode(json))
  }
  if (bytes[0] !== 1 || bytes.length < 3) throw new Error('Unknown remote record')
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(1)
  if (
    length > uploadTransferLimits.headerBytes ||
    bytes.length <= 3 + length ||
    bytes.length - 3 - length > uploadTransferLimits.chunkBytes
  )
    throw new Error('Invalid upload record length')
  const header = uploadChunkHeaderSchema.parse(JSON.parse(decoder.decode(bytes.subarray(3, 3 + length))))
  return { ...header, bytes: bytes.subarray(3 + length) }
}
