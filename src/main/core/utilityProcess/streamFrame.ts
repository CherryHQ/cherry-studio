import type { UtilityProcessStreamFrame, UtilityProcessStreamLimits } from './types'

export function isStreamLimits(value: unknown): value is UtilityProcessStreamLimits {
  if (typeof value !== 'object' || value === null) return false
  const limits = value as UtilityProcessStreamLimits
  return (
    [limits.maxFrameBytes, limits.maxBufferedBytes, limits.maxBufferedFrames, limits.maxPendingWrites].every(
      (n) => Number.isSafeInteger(n) && n > 0
    ) && limits.maxFrameBytes <= limits.maxBufferedBytes
  )
}

export function encodeStreamFrame(
  frame: UtilityProcessStreamFrame,
  maxBytes: number
): { metadata: string; payload?: Uint8Array; bytes: number } {
  const metadata = frame.metadata
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))
    throw new TypeError('Invalid stream metadata')
  const snapshot: Record<string, string | number | boolean | null> = Object.create(null)
  for (const [key, value] of Object.entries(metadata)) {
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      !(typeof value === 'number' && Number.isFinite(value))
    ) {
      throw new TypeError('Stream metadata must contain only scalar values')
    }
    snapshot[key] = value
  }
  if (frame.payload !== undefined && !(frame.payload instanceof Uint8Array))
    throw new TypeError('Invalid stream payload')
  const json = JSON.stringify(snapshot)
  const bytes = Buffer.byteLength(json) + (frame.payload?.byteLength ?? 0)
  if (bytes > maxBytes) throw new RangeError('Stream frame exceeds byte limit')
  return { metadata: json, payload: frame.payload === undefined ? undefined : new Uint8Array(frame.payload), bytes }
}
