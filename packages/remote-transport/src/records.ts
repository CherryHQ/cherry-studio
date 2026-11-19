import {
  isUploadChunk,
  remoteLimits,
  uploadChunkHeaderSchema,
  uploadTransferLimits,
  type UploadChunk
} from '@cherrystudio/remote-protocol'

export type JsonControlRecord =
  | null
  | boolean
  | number
  | string
  | JsonControlRecord[]
  | { [key: string]: JsonControlRecord }
export type TransportRecord = JsonControlRecord | UploadChunk

// Schema parsers can drop reserved object keys; wire validation must retain every key.
function isJsonControlRecord(value: unknown): value is JsonControlRecord {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonControlRecord)
  return typeof value === 'object' && Object.values(value).every(isJsonControlRecord)
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
export const binaryRecordBytes = uploadTransferLimits.chunkBytes + uploadTransferLimits.headerBytes + 3

// Preserve reserved keys and optional-field omission without rebuilding wire objects.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public outbound records are unvalidated JavaScript values; reject lossy values before JSON serialization.
function validateControlInput(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || value === null) throw new Error('Invalid JSON control record')
  const array = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (
    (!array && prototype !== Object.prototype && prototype !== null) ||
    ('toJSON' in value && typeof value.toJSON === 'function') ||
    ancestors.has(value)
  )
    throw new Error('Invalid JSON control record')
  ancestors.add(value)
  for (const child of array ? value : Object.values(value)) {
    if (child === undefined && !array) continue
    validateControlInput(child, ancestors)
  }
  ancestors.delete(value)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A public send can contain binary uploads or control values; each branch validates its own wire representation.
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
  validateControlInput(value)
  const json = JSON.stringify(value)
  if (json === undefined) throw new Error('Invalid JSON control record')
  const bytes = encoder.encode(json)
  if (bytes.length > remoteLimits.recordBytes) throw new Error('Remote record budget exceeded')
  return bytes
}

export function decodeRecord(bytes: Uint8Array): TransportRecord {
  if (bytes[0] !== 1) {
    const json = bytes
    if (json.length > remoteLimits.recordBytes) throw new Error('Remote record budget exceeded')
    const value: unknown = JSON.parse(decoder.decode(json))
    if (!isJsonControlRecord(value)) throw new Error('Invalid JSON control record')
    return value
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
